const path = require("node:path");

async function hasExistingSettingsProfile({ fs, userDataPath, development }) {
  const database = development ? "transcriptions-dev.db" : "transcriptions.db";
  const markers = [
    path.join(userDataPath, ".env"),
    path.join(userDataPath, "secure-keys", ".migrated"),
    path.join(userDataPath, database),
  ];
  const exists = await Promise.all(
    markers.map(async (marker) => {
      try {
        const stat = await fs.stat(marker); // existence only: never open or read the marker
        return stat.isFile();
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    })
  );
  return exists.some(Boolean);
}

module.exports = { hasExistingSettingsProfile };
