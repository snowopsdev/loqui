// One source of channel selection for local packaging and hosted releases.
const config = require("./electron-builder.json");
const product = require("./src/config/product.json");
config.appId = product.appId;
config.productName = product.name;
const { version } = require("./package.json");
config.publish = config.publish.map((entry) => ({
  ...entry,
  channel: version.includes("-") ? "beta" : "latest",
}));
module.exports = config;
