// Shared production/preview payload validation. No authority, settings or I/O.
function validateCapturedTextInput(input) {
  if (
    !input ||
    Object.keys(input).some((key) => !["messages", "wordCount"].includes(key)) ||
    !Number.isSafeInteger(input.wordCount) ||
    input.wordCount < 0 ||
    !Array.isArray(input.messages) ||
    input.messages.length !== 1 ||
    input.messages[0].role !== "user" ||
    typeof input.messages[0].content !== "string" ||
    input.messages[0].content.length > 20000
  )
    throw new Error("Invalid captured cleanup input.");
  return input;
}
module.exports = { validateCapturedTextInput };
