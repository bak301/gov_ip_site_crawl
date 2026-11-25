function splitStructuredColumns(type, outputData, fieldCount) {
  const parts = String(outputData || "").replace(/\n+$/, "").split("\t");
  if (parts.length < 2) return null;

  // Patent extraction writes Image + fields + diary. Trademark/design
  // extraction also writes a dedicated record-type value after Image.
  const hasDedicatedRecordType = type !== "PATENTS";
  const fieldStart = hasDedicatedRecordType ? 2 : 1;
  return {
    image: parts[0] || "",
    recordType: hasDedicatedRecordType ? (parts[1] || "") : "",
    fieldValues: parts.slice(fieldStart, fieldStart + fieldCount),
    diaryRaw: parts.slice(fieldStart + fieldCount).join("\t"),
  };
}

module.exports = { splitStructuredColumns };
