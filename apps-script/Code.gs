// 명화 퀴즈 결과 수합용 Apps Script
// 구글 시트 > 확장 프로그램 > Apps Script 에 이 코드를 통째로 붙여넣고 웹 앱으로 배포하세요.

const SHEET_NAME = "퀴즈 결과";
const HEADERS = ["제출 시각", "이름", "점수", "문제 수", "정답률(%)", "틀린 작품"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    const score = Number(data.score) || 0;
    const total = Number(data.total) || 0;
    sheet.appendRow([
      new Date(),
      clean_(data.name, 30),
      score,
      total,
      total ? Math.round((score / total) * 100) : 0,
      clean_(data.wrong, 300),
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 브라우저로 주소를 열었을 때 연결 확인용
function doGet() {
  return json_({ ok: true, message: "명화 퀴즈 결과 수합기가 동작 중이에요." });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }
  return sheet;
}

// 시트 수식으로 해석되지 않도록 정리
function clean_(value, maxLength) {
  let s = String(value || "").trim().slice(0, maxLength);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
