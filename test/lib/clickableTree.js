// Keep the notice-test API on the same fake DOM used by existing consumers.
const { installTree } = require("../helpers/harness/fakeDomTree");

module.exports = { installClickableTree: installTree };
