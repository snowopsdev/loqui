// Builds minimal ELF64 and Mach-O images carrying only what the loader-facing
// readers in scripts/lib/native-image.js look at, so tests can exercise them
// (and the afterPack checks) on any host.

const align = (value, to = 8) => Math.ceil(value / to) * to;

function elfImage({
  needed = [],
  rpath = null,
  runpath = null,
  versionNeeds = [],
  symbolNames = [],
  // A dynamic symbol whose name starts this many bytes into the RPATH string.
  symbolIntoRpath = null,
  appendix = Buffer.alloc(0),
} = {}) {
  const strings = [Buffer.from([0])];
  let strSize = 1;
  const addString = (value) => {
    const index = strSize;
    const bytes = Buffer.from(`${value}\0`);
    strings.push(bytes);
    strSize += bytes.length;
    return index;
  };
  const neededIndexes = needed.map(addString);
  const rpathIndex = rpath === null ? null : addString(rpath);
  const runpathIndex = runpath === null ? null : addString(runpath);
  const needs = versionNeeds.map(({ file, versions }) => ({
    file: addString(file),
    versions: versions.map(addString),
  }));
  const symbols = symbolNames.map(addString);
  if (symbolIntoRpath !== null) symbols.push(rpathIndex + symbolIntoRpath);
  const dynstr = Buffer.concat(strings);

  const verneedParts = [];
  needs.forEach((need, i) => {
    const header = Buffer.alloc(16);
    header.writeUInt16LE(1, 0);
    header.writeUInt16LE(need.versions.length, 2);
    header.writeUInt32LE(need.file, 4);
    header.writeUInt32LE(16, 8);
    header.writeUInt32LE(i === needs.length - 1 ? 0 : 16 + 16 * need.versions.length, 12);
    verneedParts.push(header);
    need.versions.forEach((name, j) => {
      const aux = Buffer.alloc(16);
      aux.writeUInt16LE(j + 2, 6);
      aux.writeUInt32LE(name, 8);
      aux.writeUInt32LE(j === need.versions.length - 1 ? 0 : 16, 12);
      verneedParts.push(aux);
    });
  });
  const verneed = Buffer.concat(verneedParts);

  const dynsym = Buffer.alloc(24 * (symbols.length + 1));
  symbols.forEach((name, i) => dynsym.writeUInt32LE(name, 24 * (i + 1)));

  const dynstrOffset = 64 + 2 * 56;
  const verneedOffset = align(dynstrOffset + dynstr.length);
  const dynsymOffset = align(verneedOffset + verneed.length);
  const dynamicOffset = align(dynsymOffset + dynsym.length);
  const entries = [
    ...neededIndexes.map((index) => [1, index]),
    ...(rpathIndex === null ? [] : [[15, rpathIndex]]),
    ...(runpathIndex === null ? [] : [[29, runpathIndex]]),
    [5, dynstrOffset],
    [10, dynstr.length],
    ...(needs.length > 0
      ? [
          [0x6ffffffe, verneedOffset],
          [0x6fffffff, needs.length],
        ]
      : []),
    [0, 0],
  ];
  const dynamic = Buffer.alloc(16 * entries.length);
  entries.forEach(([tag, value], i) => {
    dynamic.writeBigInt64LE(BigInt(tag), 16 * i);
    dynamic.writeBigUInt64LE(BigInt(value), 16 * i + 8);
  });
  const appendixOffset = dynamicOffset + dynamic.length;
  const shOffset = align(appendixOffset + appendix.length);
  const size = shOffset + 2 * 64;

  const image = Buffer.alloc(size);
  image.writeUInt32LE(0x464c457f, 0);
  image[4] = 2; // ELFCLASS64
  image[5] = 1; // little-endian
  image[6] = 1;
  image.writeUInt16LE(3, 16); // ET_DYN
  image.writeUInt16LE(62, 18); // x86-64
  image.writeUInt32LE(1, 20);
  image.writeBigUInt64LE(64n, 32);
  image.writeBigUInt64LE(BigInt(shOffset), 40);
  image.writeUInt16LE(64, 52);
  image.writeUInt16LE(56, 54);
  image.writeUInt16LE(2, 56);
  image.writeUInt16LE(64, 58);
  image.writeUInt16LE(2, 60);
  const writeSegment = (base, type, offset, filesz) => {
    image.writeUInt32LE(type, base);
    image.writeBigUInt64LE(BigInt(offset), base + 8);
    image.writeBigUInt64LE(BigInt(offset), base + 16);
    image.writeBigUInt64LE(BigInt(offset), base + 24);
    image.writeBigUInt64LE(BigInt(filesz), base + 32);
    image.writeBigUInt64LE(BigInt(filesz), base + 40);
  };
  writeSegment(64, 1, 0, size); // PT_LOAD, vaddr == offset
  writeSegment(64 + 56, 2, dynamicOffset, dynamic.length); // PT_DYNAMIC
  dynstr.copy(image, dynstrOffset);
  verneed.copy(image, verneedOffset);
  dynsym.copy(image, dynsymOffset);
  dynamic.copy(image, dynamicOffset);
  appendix.copy(image, appendixOffset);
  const dynsymHeader = shOffset + 64;
  image.writeUInt32LE(11, dynsymHeader + 4); // SHT_DYNSYM
  image.writeBigUInt64LE(BigInt(dynsymOffset), dynsymHeader + 24);
  image.writeBigUInt64LE(BigInt(dynsym.length), dynsymHeader + 32);
  image.writeBigUInt64LE(24n, dynsymHeader + 56);
  return image;
}

const CPU_TYPES = { arm64: 0x0100000c, x86_64: 0x01000007 };

function machOString(command, stringOffset, value) {
  const bytes = Buffer.from(`${value}\0`);
  const out = Buffer.alloc(align(stringOffset + bytes.length));
  command.copy(out);
  bytes.copy(out, stringOffset);
  out.writeUInt32LE(out.length, 4);
  return out;
}

function dylibCommand(type, name) {
  const command = Buffer.alloc(24);
  command.writeUInt32LE(type, 0);
  command.writeUInt32LE(24, 8);
  command.writeUInt32LE(2, 12);
  return machOString(command, 24, name);
}

function machOImage({
  arch = "arm64",
  filetype = 2, // MH_EXECUTE; 6 is MH_DYLIB
  id = null,
  dylibs = [],
  rpath = [],
  uuid = null,
  appendix = Buffer.alloc(0),
} = {}) {
  const commands = [];
  if (id) commands.push(dylibCommand(0xd, id));
  for (const name of dylibs) commands.push(dylibCommand(0xc, name));
  for (const entry of rpath) {
    const command = Buffer.alloc(12);
    command.writeUInt32LE(0x8000001c, 0);
    command.writeUInt32LE(12, 8);
    commands.push(machOString(command, 12, entry));
  }
  if (uuid) {
    const command = Buffer.alloc(24);
    command.writeUInt32LE(0x1b, 0);
    command.writeUInt32LE(24, 4);
    Buffer.from(uuid, "hex").copy(command, 8);
    commands.push(command);
  }
  const body = Buffer.concat(commands);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeInt32LE(CPU_TYPES[arch], 4);
  header.writeUInt32LE(filetype, 12);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(body.length, 20);
  return Buffer.concat([header, body, appendix]);
}

function fatMachOImage(slices) {
  const header = Buffer.alloc(8 + 20 * slices.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  let offset = align(header.length, 16);
  const parts = [];
  slices.forEach((slice, i) => {
    header.writeInt32BE(slice.readInt32LE(4), 8 + 20 * i);
    header.writeUInt32BE(offset, 8 + 20 * i + 8);
    header.writeUInt32BE(slice.length, 8 + 20 * i + 12);
    header.writeUInt32BE(4, 8 + 20 * i + 16);
    parts.push({ offset, slice });
    offset = align(offset + slice.length, 16);
  });
  const image = Buffer.alloc(offset);
  header.copy(image);
  for (const part of parts) part.slice.copy(image, part.offset);
  return image;
}

module.exports = { elfImage, fatMachOImage, machOImage };
