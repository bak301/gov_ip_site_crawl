"use strict";

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detailLabel(row) {
  const label = row.previousElementSibling;
  return label?.classList?.contains("product-form-label")
    ? normalizeLabel(label.textContent)
    : "";
}

function joinedColumns(row, selector) {
  return Array.from(row.querySelectorAll(selector))
    .map((element) => normalizeLabel(element.textContent))
    .filter(Boolean);
}

function extractNiceClasses(row) {
  const classRows = Array.from(row.querySelectorAll(".row"));
  if (!classRows.length) return normalizeLabel(row.textContent);

  return classRows.map((classRow) => {
    const classCell = classRow.querySelector(".col-md-2");
    const goodsCell = classRow.querySelector(".col-md-10");
    const classText = normalizeLabel(classCell?.textContent);
    const goodsText = normalizeLabel(goodsCell?.textContent);
    const classNumber = classText.match(/\d+/)?.[0];
    if (!classNumber || !goodsCell) return normalizeLabel(classRow.textContent);
    return `Class/Nhóm ${classNumber.padStart(2, "0")}: ${goodsText}`;
  }).filter(Boolean).join("<lf>");
}

function extractTrademarkFieldValue(row, label) {
  if (label === "(400) Số công bố và ngày công bố") {
    const rows = Array.from(row.querySelectorAll(".row"));
    if (rows.length) {
      return rows.map((item) => joinedColumns(item, ".col-md-4").join(" "))
        .filter(Boolean).join(" | ");
    }
  }

  if (label === "(300) Chi tiết về dữ liệu ưu tiên") {
    const parts = joinedColumns(row, ".col-md-6, .col-md-4, span");
    if (parts.length) return parts.join(" | ");
  }

  if (label === "(511) Nhóm sản phẩm/dịch vụ") {
    return extractNiceClasses(row);
  }

  if (label === "(531) Phân loại hình") {
    const rows = Array.from(row.querySelectorAll(".row"))
      .map((item) => normalizeLabel(item.textContent))
      .filter(Boolean);
    if (rows.length) return rows.join(" | ");
  }

  return normalizeLabel(row.textContent);
}

function extractTrademarkFields(doc) {
  const fields = {};
  for (const row of doc.querySelectorAll(".product-form-details")) {
    const label = detailLabel(row);
    if (!label) continue;
    const value = extractTrademarkFieldValue(row, label);
    fields[label] = fields[label] && value ? `${fields[label]} | ${value}` : value;
  }
  return fields;
}

module.exports = { extractNiceClasses, extractTrademarkFields };
