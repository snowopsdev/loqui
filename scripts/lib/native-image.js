// Reads the loader-facing parts of ELF and Mach-O images without external
// tools: library search paths (DT_RPATH/DT_RUNPATH, LC_RPATH), dependencies,
// Mach-O install names and UUIDs, and ELF symbol version requirements.
//
// Every bundled native image must find its libraries inside the app. Upstream
// sherpa-onnx links $ORIGIN/../../../sherpa_onnx/lib into its executables;
// from an AppImage's resources/bin that is /tmp/sherpa_onnx/lib, which any
// local user can create, and the loader searches it for libstdc++ before the
// system directories. checkSearchPath rejects such entries, and
// dropElfSearchPaths removes them from upstream ELF images in place.
const path = require("path");

const ELF_MAGIC = 0x464c457f; // "\x7fELF", read little-endian
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const SHT_DYNSYM = 11;
const DT_NULL = 0;
const DT_NEEDED = 1;
const DT_STRTAB = 5;
const DT_STRSZ = 10;
const DT_SONAME = 14;
const DT_RPATH = 15;
const DT_RUNPATH = 29;
const DT_VERDEF = 0x6ffffffc;
const DT_VERDEFNUM = 0x6ffffffd;
const DT_VERNEED = 0x6ffffffe;
const DT_VERNEEDNUM = 0x6fffffff;
const DT_AUXILIARY = 0x7ffffffd;
const DT_FILTER = 0x7fffffff;
const ELF_STRING_TAGS = new Set([
  DT_NEEDED,
  DT_SONAME,
  DT_RPATH,
  DT_RUNPATH,
  DT_AUXILIARY,
  DT_FILTER,
]);

const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_EXECUTE = 2;
const LC_LOAD_DYLIB = 0xc;
const LC_ID_DYLIB = 0xd;
const LC_UUID = 0x1b;
// LC_REQ_DYLD (0x80000000) is set on these; written out because JS bitwise
// operators would make them negative.
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_RPATH = 0x8000001c;
const LC_REEXPORT_DYLIB = 0x8000001f;
const LC_LAZY_LOAD_DYLIB = 0x20;
const LC_LOAD_UPWARD_DYLIB = 0x80000023;
const DYLIB_LOAD_COMMANDS = new Set([
  LC_LOAD_DYLIB,
  LC_LOAD_WEAK_DYLIB,
  LC_REEXPORT_DYLIB,
  LC_LAZY_LOAD_DYLIB,
  LC_LOAD_UPWARD_DYLIB,
]);
const CPU_TYPES = { 7: "i386", 12: "arm", 0x01000007: "x86_64", 0x0100000c: "arm64" };
// SIP keeps these root-owned and read-only; Swift binaries carry /usr/lib/swift.
const MACOS_SYSTEM_PREFIXES = ["/usr/lib/", "/System/Library/"];

function cString(image, start, limit = image.length) {
  const end = image.indexOf(0, start);
  if (start >= limit || end < 0 || end > limit) throw new Error(`unterminated string at ${start}`);
  return image.toString("utf8", start, end);
}

// ---------------------------------------------------------------------------
// ELF (64-bit little-endian, the only Linux target Loqui ships)
// ---------------------------------------------------------------------------

function readElfLayout(image) {
  if (image[4] !== 2 || image[5] !== 1) {
    throw new Error("only 64-bit little-endian ELF images are supported");
  }
  const phoff = Number(image.readBigUInt64LE(0x20));
  const phentsize = image.readUInt16LE(0x36);
  const phnum = image.readUInt16LE(0x38);
  const loads = [];
  let dynamic = null;
  for (let i = 0; i < phnum; i++) {
    const base = phoff + i * phentsize;
    const type = image.readUInt32LE(base);
    const segment = {
      offset: Number(image.readBigUInt64LE(base + 8)),
      vaddr: Number(image.readBigUInt64LE(base + 16)),
      filesz: Number(image.readBigUInt64LE(base + 32)),
    };
    if (type === PT_LOAD) loads.push(segment);
    else if (type === PT_DYNAMIC) dynamic = segment;
  }
  const toOffset = (vaddr) => {
    const segment = loads.find((s) => vaddr >= s.vaddr && vaddr < s.vaddr + s.filesz);
    if (!segment) throw new Error(`address 0x${vaddr.toString(16)} is not in a loaded segment`);
    return segment.offset + vaddr - segment.vaddr;
  };
  const entries = [];
  if (dynamic) {
    for (let off = dynamic.offset; off + 16 <= dynamic.offset + dynamic.filesz; off += 16) {
      const tag = Number(image.readBigInt64LE(off));
      if (tag === DT_NULL) break;
      entries.push({ tag, value: Number(image.readBigUInt64LE(off + 8)), offset: off });
    }
  }
  const valueOf = (tag) => entries.find((entry) => entry.tag === tag)?.value;
  const strtab = entries.length > 0 ? toOffset(valueOf(DT_STRTAB)) : 0;
  const strsz = valueOf(DT_STRSZ) ?? 0;
  const readString = (index) => cString(image, strtab + index, strtab + strsz);
  return { entries, valueOf, toOffset, strtab, strsz, readString };
}

function* elfVersionNeeds(image, layout) {
  const count = layout.valueOf(DT_VERNEEDNUM) ?? 0;
  let need = count > 0 ? layout.toOffset(layout.valueOf(DT_VERNEED)) : 0;
  for (let i = 0; i < count; i++) {
    const versions = [];
    const names = [image.readUInt32LE(need + 4)];
    let aux = need + image.readUInt32LE(need + 8);
    for (let j = 0; j < image.readUInt16LE(need + 2); j++) {
      names.push(image.readUInt32LE(aux + 8));
      versions.push(layout.readString(image.readUInt32LE(aux + 8)));
      aux += image.readUInt32LE(aux + 12);
    }
    yield { file: layout.readString(names[0]), versions, stringIndexes: names };
    need += image.readUInt32LE(need + 12);
  }
}

function elfVersionDefinitionNames(image, layout) {
  const names = [];
  const count = layout.valueOf(DT_VERDEFNUM) ?? 0;
  let def = count > 0 ? layout.toOffset(layout.valueOf(DT_VERDEF)) : 0;
  for (let i = 0; i < count; i++) {
    let aux = def + image.readUInt32LE(def + 12);
    for (let j = 0; j < image.readUInt16LE(def + 6); j++) {
      names.push(image.readUInt32LE(aux));
      aux += image.readUInt32LE(aux + 4);
    }
    def += image.readUInt32LE(def + 16);
  }
  return names;
}

function elfDynamicSymbolNames(image) {
  const shoff = Number(image.readBigUInt64LE(0x28));
  const shentsize = image.readUInt16LE(0x3a);
  const shnum = image.readUInt16LE(0x3c);
  if (shoff === 0 || shnum === 0) return null;
  const names = [];
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize;
    if (image.readUInt32LE(base + 4) !== SHT_DYNSYM) continue;
    const offset = Number(image.readBigUInt64LE(base + 24));
    const size = Number(image.readBigUInt64LE(base + 32));
    const entsize = Number(image.readBigUInt64LE(base + 56)) || 24;
    for (let sym = offset; sym + entsize <= offset + size; sym += entsize) {
      names.push(image.readUInt32LE(sym));
    }
  }
  return names;
}

function parseElf(image) {
  const layout = readElfLayout(image);
  const result = { format: "elf", needed: [], rpath: [], runpath: [], versionNeeds: [] };
  for (const { tag, value } of layout.entries) {
    if (tag === DT_NEEDED) result.needed.push(layout.readString(value));
    else if (tag === DT_RPATH) result.rpath.push(...layout.readString(value).split(":"));
    else if (tag === DT_RUNPATH) result.runpath.push(...layout.readString(value).split(":"));
  }
  for (const { file, versions } of elfVersionNeeds(image, layout)) {
    result.versionNeeds.push({ file, versions });
  }
  return result;
}

// Drops the trailing search-path entries `keep` rejects by moving the string's
// terminator, so DT_RPATH stays DT_RPATH and nothing else in the image moves.
// Refuses when the edit would also shorten another string sharing those bytes.
function dropElfSearchPaths(image, keep) {
  const layout = readElfLayout(image);
  const changes = [];
  for (const entry of layout.entries) {
    if (entry.tag !== DT_RPATH && entry.tag !== DT_RUNPATH) continue;
    const before = layout.readString(entry.value).split(":");
    const kept = before.filter(keep);
    if (kept.length === before.length) continue;
    if (kept.length === 0) {
      // An empty search path means the working directory to glibc.
      throw new Error(`every entry of ${before.join(":")} would be dropped`);
    }
    if (kept.some((value, index) => before[index] !== value)) {
      throw new Error(`cannot drop non-trailing entries from ${before.join(":")} in place`);
    }
    const cut = entry.value + kept.join(":").length;
    changes.push({ index: entry.value, cut, before, after: kept });
  }
  if (changes.length === 0) return [];

  const symbolNames = elfDynamicSymbolNames(image);
  if (!symbolNames) throw new Error("no section headers; cannot prove the edit is safe");
  const references = [
    ...layout.entries.filter((entry) => ELF_STRING_TAGS.has(entry.tag)).map((e) => e.value),
    ...[...elfVersionNeeds(image, layout)].flatMap((need) => need.stringIndexes),
    ...elfVersionDefinitionNames(image, layout),
    ...symbolNames,
  ];
  for (const { index, cut, before } of changes) {
    const shared = references.find((ref) => ref > index && ref <= cut);
    if (shared !== undefined) {
      throw new Error(`${before.join(":")} shares bytes with ${layout.readString(shared)}`);
    }
  }
  for (const { cut } of changes) image[layout.strtab + cut] = 0;
  return changes.map(({ before, after }) => ({ before, after }));
}

// ---------------------------------------------------------------------------
// Mach-O
// ---------------------------------------------------------------------------

function formatMachOVersion(value) {
  return `${value >>> 16}.${(value >> 8) & 0xff}.${value & 0xff}`;
}

function parseMachOSlice(image, start) {
  const magic = image.readUInt32LE(start);
  const headerSize = magic === MH_MAGIC_64 ? 32 : 28;
  const cputype = image.readInt32LE(start + 4);
  const slice = {
    arch: CPU_TYPES[cputype] ?? `cpu-${cputype}`,
    filetype: image.readUInt32LE(start + 12),
    id: null,
    uuid: null,
    rpath: [],
    dylibs: [],
  };
  const ncmds = image.readUInt32LE(start + 16);
  let cmd = start + headerSize;
  for (let i = 0; i < ncmds; i++) {
    const type = image.readUInt32LE(cmd);
    const size = image.readUInt32LE(cmd + 4);
    if (size < 8) throw new Error(`malformed load command ${i}`);
    const string = () => cString(image, cmd + image.readUInt32LE(cmd + 8), cmd + size);
    if (type === LC_RPATH) {
      slice.rpath.push(string());
    } else if (type === LC_ID_DYLIB || DYLIB_LOAD_COMMANDS.has(type)) {
      const dylib = {
        name: string(),
        currentVersion: formatMachOVersion(image.readUInt32LE(cmd + 16)),
        compatibilityVersion: formatMachOVersion(image.readUInt32LE(cmd + 20)),
      };
      if (type === LC_ID_DYLIB) slice.id = dylib;
      else slice.dylibs.push(dylib);
    } else if (type === LC_UUID) {
      slice.uuid = image.toString("hex", cmd + 8, cmd + 24);
    }
    cmd += size;
  }
  return slice;
}

function parseMachO(image) {
  const bigMagic = image.readUInt32BE(0);
  if (bigMagic === FAT_MAGIC || bigMagic === FAT_MAGIC_64) {
    const count = image.readUInt32BE(4);
    const entrySize = bigMagic === FAT_MAGIC ? 20 : 32;
    const slices = [];
    for (let i = 0; i < count; i++) {
      const entry = 8 + i * entrySize;
      const offset =
        bigMagic === FAT_MAGIC
          ? image.readUInt32BE(entry + 8)
          : Number(image.readBigUInt64BE(entry + 8));
      slices.push(parseMachOSlice(image, offset));
    }
    return { format: "macho", slices };
  }
  return { format: "macho", slices: [parseMachOSlice(image, 0)] };
}

// Returns null for anything that is not an ELF or Mach-O image.
function readNativeImage(image) {
  if (image.length < 64) return null;
  if (image.readUInt32LE(0) === ELF_MAGIC) return parseElf(image);
  const littleMagic = image.readUInt32LE(0);
  if (littleMagic === MH_MAGIC || littleMagic === MH_MAGIC_64) return parseMachO(image);
  const bigMagic = image.readUInt32BE(0);
  // Java class files share 0xcafebabe; their next word is a class version (>= 45).
  if ((bigMagic === FAT_MAGIC || bigMagic === FAT_MAGIC_64) && image.readUInt32BE(4) < 32) {
    return parseMachO(image);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search-path policy
// ---------------------------------------------------------------------------

// `baseDir` is a directory relative to the bundle root, in POSIX form.
function staysInBundle(baseDir, rest) {
  const resolved = path.posix.normalize(path.posix.join(baseDir || ".", `.${rest}`));
  return resolved !== ".." && !resolved.startsWith("../");
}

// Returns why a search-path entry can leave the bundle, or null if it cannot.
// `imageDir` is the image's directory relative to the bundle root; on macOS,
// `executableDirs` lists where @executable_path may point for this image.
function checkSearchPath(entry, { format, imageDir, executableDirs = [imageDir] }) {
  if (entry === "") return "is empty, which the loader reads as the working directory";
  if (format === "elf") {
    const origin = entry.match(/^\$(?:ORIGIN|\{ORIGIN\})((?:\/.*)?)$/);
    if (origin && !origin[1].includes("$")) {
      return staysInBundle(imageDir, origin[1]) ? null : "climbs out of the bundle";
    }
    if (entry.includes("$")) return "uses a loader token other than a leading $ORIGIN";
    return entry.startsWith("/") ? "is absolute" : "is relative to the working directory";
  }
  const loader = entry.match(/^@(loader_path|executable_path)((?:\/.*)?)$/);
  if (loader) {
    const bases = loader[1] === "loader_path" ? [imageDir] : executableDirs;
    return bases.every((base) => staysInBundle(base, loader[2]))
      ? null
      : "climbs out of the bundle";
  }
  if (entry.startsWith("@")) return "uses an unsupported @ prefix";
  if (entry.startsWith("/")) {
    return MACOS_SYSTEM_PREFIXES.some((prefix) => `${entry}/`.startsWith(prefix))
      ? null
      : "is absolute outside the SIP-protected system paths";
  }
  return "is relative to the working directory";
}

// Every way `image` can look outside the bundle for a library.
function findSearchPathEscapes(image, { imageDir, appExecutableDir }) {
  const problems = [];
  const report = (kind, value, reason) => {
    if (reason) problems.push(`${kind} ${JSON.stringify(value)} ${reason}`);
  };
  if (image.format === "elf") {
    for (const [kind, entries] of [
      ["RPATH", image.rpath],
      ["RUNPATH", image.runpath],
    ]) {
      for (const entry of entries)
        report(kind, entry, checkSearchPath(entry, { format: "elf", imageDir }));
    }
    for (const name of image.needed) {
      if (name.includes("/")) report("NEEDED", name, "is a path, not a library name");
    }
    return problems;
  }
  for (const slice of image.slices) {
    const executableDirs =
      slice.filetype === MH_EXECUTE ? [imageDir] : [imageDir, appExecutableDir].filter(Boolean);
    const context = { format: "macho", imageDir, executableDirs };
    for (const entry of slice.rpath)
      report(`${slice.arch} LC_RPATH`, entry, checkSearchPath(entry, context));
    for (const { name } of slice.dylibs) {
      // @rpath/ names resolve through LC_RPATH, which is checked above.
      if (name.startsWith("@rpath/")) continue;
      const directory = path.posix.dirname(name);
      report(`${slice.arch} dylib`, name, checkSearchPath(directory, context));
    }
  }
  return problems;
}

function compareVersionStrings(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The highest GLIBC_x and GLIBCXX_x an ELF image needs, e.g. { GLIBC: "2.34" }.
function highestSymbolVersions(image) {
  const highest = {};
  for (const { versions } of image.versionNeeds ?? []) {
    for (const version of versions) {
      const match = version.match(/^(GLIBC|GLIBCXX)_(\d+(?:\.\d+)*)$/);
      if (!match) continue;
      const [, family, number] = match;
      if (!highest[family] || compareVersionStrings(number, highest[family]) > 0) {
        highest[family] = number;
      }
    }
  }
  return highest;
}

module.exports = {
  checkSearchPath,
  compareVersionStrings,
  dropElfSearchPaths,
  findSearchPathEscapes,
  highestSymbolVersions,
  readNativeImage,
};
