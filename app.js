/* CNMI Blood Donation Supabase Frontend v15.22 */

const CONFIG = window.CNMI_CONFIG || {};
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

let selectedGender = "";
let currentQuestionIndex = 0;
let selectedSlot = "";
let currentManageBooking = null;
let modalPrimaryCallback = null;
let modalSecondaryCallback = null;
let currentStaffProfile = null;
let pendingPasswordRecovery = false;
let lastDonorContext = null;
let pendingDonorImport = null;
let lastBookingResult = null;
let activeQrScanner = null;
let imageQrScanner = null;
let staffViewMode = null;
let dashboardImportRows = [];
let dashboardImportPage = 1;
let importLogHistoryPage = 1;
let importLogHistoryTotalPages = 1;
let screeningQuestionHistoryPage = 1;
let screeningQuestionHistoryTotalPages = 1;
let screeningQuestionAuditCache = [];
let currentManualSectionId = "manual-start";
let currentGroupAdminDays = [];
let currentRoomAdminEvents = [];
let currentRoomAdminVersion = 0;
let currentRoomAdminPublishedAt = null;
let currentPublicRoomEvents = [];
let pendingStaffRouteTab = "overview";
let suppressRouteSync = false;
let staffQuestionFilter = "all";
let currentStaffQuestion = null;
let currentDonorChatAccessToken = "";
let currentDonorChatPublicCode = "";
let currentDonorChatPhoneLast4 = "";
let donorChatIntakeState = null;
let donorChatLocalTranscript = [];
let donorChatPendingEscalationMessage = "";
let donorChatRestoringLocalDraft = false;
let pendingStaffQuestionCode = "";
let donorKnowledgeCache = [];
let donorKnowledgeLoadedAt = 0;
let currentKnowledgeId = null;
let currentKnowledgeSourceQuestionId = null;
let staffKnowledgeRows = [];

const DONOR_CHAT_STORAGE = {
  token:"cnmiDonorChatToken",
  code:"cnmiDonorChatCode",
  phone4:"cnmiDonorChatPhone4",
  draft:"cnmiDonorChatDraftV1",
  history:"cnmiDonorChatThreadsV1"
};

const PAGE_ROUTE_MAP = {
  home: "#/home",
  check: "#/next",
  prepare: "#/prepare",
  donationChoice: "#/donate",
  screening: "#/platelet",
  booking: "#/platelet/booking",
  bookingSuccess: "#/platelet/success",
  groupBooking: "#/group-booking",
  mobileUnitRequest: "#/mobile-unit",
  manage: "#/manage",
  roomCalendar: "#/hours",
  info: "#/contact",
  question: "#/ask",
  staffLogin: "#/staff/login",
  staffChangePassword: "#/staff/password",
  staff: "#/staff/overview"
};

const STAFF_TAB_ROUTE_MAP = {
  overview: "overview",
  donorImport: "donor-import",
  infectiousImport: "infectious-import",
  importLogs: "import-logs",
  notifications: "notifications",
  questions: "questions",
  knowledge: "knowledge-base",
  slots: "platelet-calendar",
  bookings: "platelet-bookings",
  groupSlots: "group-calendar",
  groups: "group-requests",
  mobileUnits: "mobile-unit-requests",
  roomCalendar: "room-calendar",
  screeningQuestions: "screening-questions",
  screeningQuestionHistory: "screening-question-history",
  manual: "manual",
  admin: "admin"
};

const STAFF_TAB_GROUP_MAP = {
  overview:"today", notifications:"today", questions:"today", knowledge:"today", bookings:"today",
  donorImport:"donorData", infectiousImport:"donorData", importLogs:"donorData",
  slots:"appointments", groupSlots:"appointments", groups:"appointments", mobileUnits:"appointments", roomCalendar:"appointments",
  screeningQuestions:"screening", screeningQuestionHistory:"screening",
  manual:"help", admin:"admin"
};

function getPublicBaseUrl() {
  const configured = String(CONFIG.APP_URL || "").trim().replace(/\/$/, "");
  return configured || (window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "").replace(/\/$/, ""));
}

function routeUrl(page) {
  return getPublicBaseUrl() + (PAGE_ROUTE_MAP[page] || "#/home");
}

function syncPageRoute(page, replace) {
  if (suppressRouteSync) return;
  let hash = PAGE_ROUTE_MAP[page] || "#/home";
  if (page === "staff") {
    const active = document.querySelector('.staff-tab.active');
    const tab = active?.dataset?.staffTab || pendingStaffRouteTab || "overview";
    hash = "#/staff/" + (STAFF_TAB_ROUTE_MAP[tab] || "overview");
  }
  if (window.location.hash === hash) return;
  const fn = replace ? "replaceState" : "pushState";
  try { history[fn]({ cnmiRoute: hash }, "", hash); }
  catch (err) { window.location.hash = hash; }
}

function tabFromRoutePart(part) {
  const clean = String(part || "").replace(/^\/+|\/+$/g, "");
  const match = Object.entries(STAFF_TAB_ROUTE_MAP).find(([, route]) => route === clean);
  return match ? match[0] : "overview";
}

function parseHashRoute() {
  const hash = String(window.location.hash || "");
  const hashParts = hash.split("?");
  const path = hashParts[0].replace(/^#\/?/, "").replace(/^\/+|\/+$/g, "");
  const routeParams = new URLSearchParams(hashParts.slice(1).join("?"));
  if (!path) return { page:"home" };
  const map = {
    home:"home", check:"check", next:"check", prepare:"prepare", donate:"donationChoice", "group-booking":"groupBooking",
    "mobile-unit":"mobileUnitRequest", manage:"manage", calendar:"roomCalendar", hours:"roomCalendar", contact:"info", ask:"question", question:"question"
  };
  if (map[path]) return { page:map[path] };
  if (path === "platelet" || path === "platelet/screening") return { page:"screening" };
  if (path === "platelet/booking") return { page:"booking" };
  if (path === "platelet/success") return { page:"bookingSuccess" };
  if (path === "staff" || path.startsWith("staff/")) {
    const part = path.split("/")[1] || "overview";
    if (part === "login") return { page:"staffLogin", staff:true };
    if (part === "password") return { page:"staffChangePassword", staff:true };
    return { page:"staff", staff:true, tab:tabFromRoutePart(part), openQuestion:routeParams.get("open") || "" };
  }
  // backward compatibility from older versions
  if (hash === "#staff") return { page:"staff", staff:true, tab:"overview" };
  if (hash.startsWith("#manage")) return { page:"manage" };
  return { page:"home" };
}

async function handleHashRoute() {
  const qrToken = extractQrToken(String(window.location.hash || "") + "&" + String(window.location.search || ""));
  if (qrToken) {
    suppressRouteSync = true;
    showPage("manage");
    suppressRouteSync = false;
    await loadBookingFromQrToken(qrToken);
    return;
  }
  const route = parseHashRoute();
  if (route.staff) {
    pendingStaffRouteTab = route.tab || "overview";
    pendingStaffQuestionCode = route.openQuestion || "";
    if (route.page === "staffLogin") { suppressRouteSync = true; showPage("staffLogin"); suppressRouteSync = false; return; }
    if (route.page === "staffChangePassword") { suppressRouteSync = true; showPage("staffChangePassword"); suppressRouteSync = false; return; }
    await showStaffGate();
    if (currentStaffProfile) {
      showStaffTab(pendingStaffRouteTab, { skipRoute:true });
      if (pendingStaffRouteTab === "questions" && pendingStaffQuestionCode) {
        setTimeout(function(){ openStaffQuestionByPublicCode(pendingStaffQuestionCode); }, 220);
      }
    }
    return;
  }
  suppressRouteSync = true;
  showPage(route.page || "home");
  suppressRouteSync = false;
}

sb.auth.onAuthStateChange(async function(event, session) {
  if (event === "PASSWORD_RECOVERY") {
    pendingPasswordRecovery = true;
    if ($("pageStaffChangePassword")) showPage("staffChangePassword");
  }
});

const defaultScreeningQuestions = [
  { text:"ท่านนอนหลับพักผ่อนเพียงพอหรือไม่ อย่างน้อยประมาณ 5 ชั่วโมง", passAnswer:"yes", failMessage:"ท่านควรพักผ่อนให้เพียงพอก่อนบริจาคโลหิต" },
  { text:"ภายใน 4 ชั่วโมงที่ผ่านมา ท่านได้รับประทานอาหารมาแล้วหรือไม่", passAnswer:"yes", failMessage:"แนะนำให้รับประทานอาหารก่อนมาบริจาคโลหิต และหลีกเลี่ยงอาหารไขมันสูง" },
  { text:"ขณะนี้ท่านรู้สึกสบายดี ไม่มีไข้ ไอ เจ็บคอ หรืออาการเจ็บป่วยชัดเจน ใช่หรือไม่", passAnswer:"yes", failMessage:"หากมีอาการไม่สบาย แนะนำให้พักผ่อนก่อน และติดต่อเจ้าหน้าที่หากต้องการสอบถามเพิ่มเติม" },
  { text:"ช่วงนี้ท่านมีแผลอักเสบ ติดเชื้อ หรืออยู่ระหว่างรับประทานยาปฏิชีวนะหรือไม่", passAnswer:"no", failMessage:"กรุณาติดต่อเจ้าหน้าที่ก่อนจองคิว เพื่อประเมินความพร้อมในการบริจาคโลหิต" },
  { text:"ในช่วง 7 วันที่ผ่านมา ท่านถอนฟัน ผ่าฟันคุด หรือทำหัตถการทางทันตกรรมหรือไม่", passAnswer:"no", failMessage:"กรุณาติดต่อเจ้าหน้าที่เพื่อประเมินระยะเวลาที่เหมาะสมก่อนบริจาคโลหิต" },
  { text:"สำหรับผู้หญิง: ท่านกำลังตั้งครรภ์ หลังคลอด หรืออยู่ระหว่างให้นมบุตรหรือไม่", passAnswer:"no", gender:"หญิง", failMessage:"กรุณาติดต่อเจ้าหน้าที่ก่อนจองคิว เพื่อประเมินความพร้อมในการบริจาคโลหิต" }
];
let screeningQuestions = defaultScreeningQuestions.map(function(q){ return Object.assign({}, q); });
let currentScreeningAdminRows = [];
let screeningQuestionsLoadedAt = 0;

function $(id) { return document.getElementById(id); }

function showModal(options) {
  options = options || {};
  modalPrimaryCallback = typeof options.onPrimary === "function" ? options.onPrimary : null;
  modalSecondaryCallback = typeof options.onSecondary === "function" ? options.onSecondary : null;

  $("modalTitle").innerText = options.title || "แจ้งเตือน";
  $("modalMessage").innerText = options.message || "";

  const icon = $("modalIcon");
  icon.innerText = options.iconText || "!";
  icon.classList.remove("success", "danger");
  if (options.type === "success") icon.classList.add("success");
  if (options.type === "danger") icon.classList.add("danger");

  let html = "";
  if (options.secondaryText) {
    html += '<button type="button" class="btn btn-outline-secondary flex-grow-1 p-3" onclick="modalSecondaryClick()">' + escapeHtml(options.secondaryText) + '</button>';
  }
  html += '<button type="button" class="btn btn-search flex-grow-1 p-3" onclick="modalPrimaryClick()">' + escapeHtml(options.primaryText || "ตกลง") + '</button>';
  $("modalButtonArea").innerHTML = html;
  $("appModal").classList.add("show");
}

function closeModal() { $("appModal").classList.remove("show"); }
function modalPrimaryClick() { closeModal(); if (modalPrimaryCallback) { const cb = modalPrimaryCallback; modalPrimaryCallback = null; cb(); } }
function modalSecondaryClick() { closeModal(); if (modalSecondaryCallback) { const cb = modalSecondaryCallback; modalSecondaryCallback = null; cb(); } }

function showPage(page, options) {
  options = options || {};
  const pages = {
    home:"pageHome", check:"pageCheck", prepare:"pagePrepare", donationChoice:"pageDonationChoice", groupBooking:"pageGroupBooking",
    mobileUnitRequest:"pageMobileUnitRequest",
    screening:"pageScreening", booking:"pageBooking", bookingSuccess:"pageBookingSuccess", manage:"pageManage",
    roomCalendar:"pageRoomCalendar", info:"pageInfo", question:"pageQuestion",
    staffLogin:"pageStaffLogin", staffChangePassword:"pageStaffChangePassword", staff:"pageStaff"
  };
  Object.keys(pages).forEach(function(key){ const el = $(pages[key]); if (el) el.classList.remove("active"); });
  const target = $(pages[page] || "pageHome");
  if (target) target.classList.add("active");
  document.body.setAttribute("data-page", page || "home");
  updateMobileNav(page || "home");
  window.scrollTo(0,0);
  if (!options.skipRoute) syncPageRoute(page || "home", !!options.replaceRoute);

  if (page === "home") setTimeout(loadHomeRoomStatus, 30);
  if (page === "staff" && currentStaffProfile) {
    setTimeout(loadStaffDashboard, 50);
  }
  if (page === "screening") {
    setTimeout(loadPublicScreeningQuestions, 20);
  }
  if (page === "groupBooking") {
    setTimeout(loadGroupPublicCalendar, 40);
  }
  if (page === "roomCalendar") {
    setTimeout(loadPublicRoomCalendar, 40);
  }
  if (page === "question") {
    setTimeout(restoreDonorChatConversation, 60);
  }
}

function updateMobileNav(page) {
  document.querySelectorAll(".mobile-bottom-nav button").forEach(function(btn) {
    const targetPage = btn.getAttribute("data-nav-page");
    const bookingPages = ["donationChoice", "groupBooking", "mobileUnitRequest", "screening", "booking", "bookingSuccess"];
    const active = targetPage === page || (targetPage === "donationChoice" && bookingPages.includes(page));
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, function(ch) {
    return ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[ch];
  });
}

function onlyDigits(value) { return String(value || "").replace(/[^0-9]/g, ""); }
function cleanLookupText(value) { return String(value || "").replace(/[^A-Za-z0-9ก-๙]/g, "").toUpperCase(); }
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(new Date()).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function addDaysISO(value, days) {
  const d = isoDateObj(value);
  if (!d) return value;
  d.setDate(d.getDate() + Number(days || 0));
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function addMonthsISO(value, months) {
  const d = isoDateObj(value);
  if (!d) return value;
  const originalDay = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + Number(months || 0), 1, 12, 0, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12, 0, 0, 0).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return target.getFullYear() + "-" + pad2(target.getMonth() + 1) + "-" + pad2(target.getDate());
}

function isoDateObj(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}
function isWeekendISO(value) {
  const d = isoDateObj(value); if (!d) return false;
  return d.getDay() === 0 || d.getDay() === 6;
}
function getNextMonthEndISO() {
  const t = isoDateObj(todayISO());
  const end = new Date(t.getFullYear(), t.getMonth() + 2, 0, 12, 0, 0, 0);
  return end.getFullYear() + "-" + pad2(end.getMonth() + 1) + "-" + pad2(end.getDate());
}
function currentMonthValue() { return todayISO().slice(0, 7); }
function nextMonthValue() {
  const t = isoDateObj(todayISO());
  const d = new Date(t.getFullYear(), t.getMonth() + 1, 1, 12, 0, 0, 0);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}
function futureMonthValue(monthsAhead) {
  const t = isoDateObj(todayISO());
  const d = new Date(t.getFullYear(), t.getMonth() + Math.max(0, Number(monthsAhead || 0)), 1, 12, 0, 0, 0);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}
function monthRange(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ""))) return null;
  const [y,m] = value.split("-").map(Number);
  const last = new Date(y, m, 0, 12, 0, 0, 0).getDate();
  return { start:value + "-01", end:value + "-" + pad2(last), year:y, month:m, days:last };
}
function thaiMonthLabel(value) {
  const r = monthRange(value); if (!r) return value || "";
  return new Intl.DateTimeFormat("th-TH", { month:"long", year:"numeric" }).format(new Date(r.year, r.month - 1, 1, 12));
}

function isValidCalendarDate_(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function splitPublicDobParts_(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  // รองรับค่ารูปแบบ ISO ที่อาจมาจาก browser/โค้ดเดิม
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const isoParts = text.split("-");
    return { d: isoParts[2], m: isoParts[1], y: isoParts[0] };
  }

  // กรอก 8 หลักติดกันได้ หรือจะมี / - . คั่นก็ได้
  const digits = onlyDigits(text);
  if (digits.length !== 8) return null;
  return { d: digits.slice(0, 2), m: digits.slice(2, 4), y: digits.slice(4, 8) };
}

function normalizePublicDobInput(value) {
  const parts = splitPublicDobParts_(value);
  if (!parts) return "";

  const d = parseInt(parts.d, 10);
  const m = parseInt(parts.m, 10);
  const enteredYear = parseInt(parts.y, 10);
  if (!d || !m || Number.isNaN(enteredYear)) return "";

  // ปี 24xx–26xx ให้ตีความเป็น พ.ศ.; ปี 19xx–20xx เป็น ค.ศ.
  let y = enteredYear > 2400 ? enteredYear - 543 : enteredYear;
  const currentYear = new Date().getFullYear();

  if (y < 1900 || y > currentYear) return "";
  if (!isValidCalendarDate_(y, m, d)) return "";

  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function formatDobInputWhileTyping(value) {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatDobInputOnBlur(input) {
  if (!input) return;
  // คงปีที่ผู้ใช้กรอกไว้ (พ.ศ. หรือ ค.ศ.) แต่จัด / ให้เป็นรูปแบบเดียวกัน
  input.value = formatDobInputWhileTyping(input.value);
}

function last4FromInput(value) {
  return onlyDigits(value).slice(-4);
}

function isoToThaiDate(iso, longMonth) {
  if (!iso) return "-";
  const p = String(iso).split("-");
  if (p.length !== 3) return iso;
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = Number(p[2]);
  const monthsLong = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const monthsShort = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return d + " " + (longMonth ? monthsLong[m-1] : monthsShort[m-1]) + " " + (y + 543);
}

function isoToDDMMYYYY(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function getBloodStyle(group) {
  const g = (group || "").toUpperCase();
  if (g.includes("AB")) return { bg:"#fff", text:"#000" };
  if (g.includes("A")) return { bg:"#f1c40f", text:"#000" };
  if (g.includes("B")) return { bg:"#e84393", text:"#fff" };
  if (g.includes("O")) return { bg:"#0984e3", text:"#fff" };
  return { bg:"#eee", text:"#000" };
}

function showBusy(btn, busy, normalText, busyText) {
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? '<span class="spinner-border spinner-border-sm"></span> ' + busyText : normalText;
}

function getAuthRedirectUrl() {
  if (CONFIG.APP_URL && String(CONFIG.APP_URL).trim()) {
    return String(CONFIG.APP_URL).trim().replace(/\/+$/, "");
  }
  return window.location.origin + window.location.pathname;
}

function getStaffEmailDomain_() {
  return String(CONFIG.STAFF_EMAIL_DOMAIN || "mahidol.ac.th").trim().toLowerCase().replace(/^@+/, "");
}

function normalizeStaffEmail(value) {
  let text = String(value || "").trim().toLowerCase().replace(/\s/g, "");
  const domain = getStaffEmailDomain_();

  if (!text) return "";

  // ให้กรอกได้ทั้ง username.sur และ username.sur@mahidol.ac.th
  if (text.endsWith("@")) text = text.slice(0, -1);
  if (!text.includes("@")) return text + "@" + domain;

  return text;
}

function staffEmailLocalPart(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s/g, "");
  const suffix = "@" + getStaffEmailDomain_();

  if (text.endsWith(suffix)) return text.slice(0, -suffix.length);
  return text.replace(/@+$/, "");
}

function isAllowedStaffEmail(email) {
  const domain = getStaffEmailDomain_();
  return normalizeStaffEmail(email).endsWith("@" + domain);
}

function switchMode(mode) {
  $("tabCheck").classList.toggle("active", mode === "check");
  $("tabForgot").classList.toggle("active", mode !== "check");
  $("checkForm").classList.toggle("active", mode === "check");
  $("forgotForm").classList.toggle("active", mode !== "check");
  hideAllResults();
}

function hideAllResults() {
  $("checkResult").style.display = "none";
  $("forgotResult").style.display = "none";
  $("notFoundCard").style.display = "none";
}

function clearSearch() {
  ["donorIdInput","donorDobCheck","phoneLast4Check","idDocForgot","donorDobForgot","phoneLast4Forgot"].forEach(id => { if ($(id)) $(id).value = ""; });
  hideAllResults();
}

async function runCheckSearch() {
  const donorId = $("donorIdInput").value.trim();
  const dobRaw = $("donorDobCheck").value;
  const dob = normalizePublicDobInput(dobRaw);
  const phoneLast4 = last4FromInput($("phoneLast4Check").value);
  const btn = $("btnCheckSearch");

  if (!donorId || phoneLast4.length !== 4) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอก Donor ID และเบอร์โทรศัพท์หรือ 4 ตัวท้ายให้ครบครับ", iconText:"!" });
    return;
  }
  if (!dob) {
    showModal({ title:"ตรวจสอบวันเกิด", message:"กรุณากรอกวันเกิดให้ครบ 8 หลัก และตรวจสอบว่าเป็นวันที่จริง ระบบรองรับทั้ง พ.ศ. และ ค.ศ.", iconText:"!" });
    return;
  }

  hideAllResults();
  showBusy(btn, true, "🔍 ตรวจสอบข้อมูล", "กำลังตรวจสอบ...");

  const { data, error } = await sb.rpc("check_donor", {
    p_donor_id: donorId,
    p_dob: dob,
    p_phone_last4: phoneLast4
  });

  showBusy(btn, false, "🔍 ตรวจสอบข้อมูล", "กำลังตรวจสอบ...");

  if (error) {
    showModal({ title:"เชื่อมต่อไม่ได้", message:error.message || "ไม่สามารถเชื่อมต่อระบบได้", iconText:"!" });
    return;
  }

  if (!data || !data.found) {
    $("notFoundCard").style.display = "block";
    return;
  }

  renderDonorResult(data, donorId);
}

function renderDonorResult(res, fallbackDonorId) {
  lastDonorContext = {
    donorId: res.donorId || fallbackDonorId || "",
    name: res.name || "",
    phone: onlyDigits($("phoneLast4Check") ? $("phoneLast4Check").value : "")
  };

  const hero = $("checkHero");
  hero.classList.toggle("warning", !!res.needsContact);

  if (res.needsContact) {
    $("resultDaysLeft").innerText = "!";
    $("resultDaysLabel").innerText = "โปรดติดต่อเจ้าหน้าที่";
    $("resultStatus").innerText = res.message || "กรุณาติดต่อเจ้าหน้าที่ห้องบริจาคโลหิต";
    $("displayNextDate").innerText = "กรุณาปรึกษาเจ้าหน้าที่";
  } else {
    const daysLeft = Number(res.daysLeft || 0);
    $("resultDaysLeft").innerText = daysLeft <= 0 ? "0" : daysLeft;
    $("resultDaysLabel").innerText = daysLeft <= 0 ? "บริจาคได้เลย!" : "วัน";
    $("resultStatus").innerText = daysLeft <= 0 ? "❤️ วันนี้ท่านสามารถบริจาคโลหิตได้" : "❤️ บริจาคได้อีกครั้งตั้งแต่วันที่ " + isoToThaiDate(res.nextDate, true);
    $("displayNextDate").innerText = isoToThaiDate(res.nextDate, true);
  }

  $("displayName").innerText = res.name ? "คุณ " + res.name : "ผู้บริจาค";
  $("displayId").innerHTML = "💳 เลขผู้บริจาค (Donor ID): " + escapeHtml(res.donorId || fallbackDonorId || "-");
  $("displayDob").innerText = "🎂 วันเกิด: " + isoToThaiDate(res.dob, true);

  const style = getBloodStyle(res.blood);
  const badge = $("displayBlood");
  badge.innerText = "หมู่เลือด: " + (res.blood || "-");
  badge.style.backgroundColor = style.bg;
  badge.style.color = style.text;

  const history = Array.isArray(res.history) ? res.history : [];
  if (history.length === 0) {
    $("historyTableBody").innerHTML = '<tr><td class="text-center text-muted small p-3">ไม่พบประวัติการบริจาค กรุณาติดต่อเจ้าหน้าที่</td></tr>';
  } else {
    $("historyTableBody").innerHTML = history.map(function(h) {
      const usage = h.usage || "";
      const warn = usage.includes("ติดต่อ");
      return '<tr>' +
        '<td class="ps-3 fw-bold text-muted small" style="width:50px;">' + escapeHtml(h.count || "-") + '</td>' +
        '<td class="small">' + escapeHtml(isoToThaiDate(h.date, false)) + '<br><span class="text-primary" style="font-size:.78rem">(' + escapeHtml(h.type || "Whole Blood") + ')</span></td>' +
        '<td><span class="' + (warn ? "text-warning fw-bold" : "usage-text") + '" style="font-size:.85rem">' + (warn ? "⚠️" : "✅") + ' ' + escapeHtml(usage || "กำลังดำเนินการ") + '</span></td>' +
        '</tr>';
    }).join("");
  }

  if ($("btnBookFromResult")) {
    $("btnBookFromResult").style.display = res.needsContact ? "none" : "block";
  }
  if ($("historyPanel")) $("historyPanel").style.display = "none";
  $("checkResult").style.display = "block";
}

function toggleHistoryPanel() {
  const panel = $("historyPanel");
  if (!panel) return;
  const willOpen = panel.style.display === "none" || panel.style.display === "";
  panel.style.display = willOpen ? "block" : "none";
  const btn = $("btnToggleHistory");
  if (btn) btn.innerHTML = willOpen
    ? '<i class="bi bi-chevron-up"></i> ซ่อนประวัติการบริจาค'
    : '<i class="bi bi-clock-history"></i> ดูประวัติการบริจาค';
}

function goBookingFromResult() {
  if (!lastDonorContext || !lastDonorContext.donorId) {
    showModal({ title:"ยังไม่พบข้อมูลผู้บริจาค", message:"กรุณาตรวจสอบข้อมูลผู้บริจาคก่อนดำเนินการ", iconText:"!" });
    return;
  }
  prefillPlateletBookingFromDonorContext();
  showDonationChoice();
}

function prefillPlateletBookingFromDonorContext() {
  if (!lastDonorContext) return;
  if ($("bookingName")) $("bookingName").value = lastDonorContext.name || "";
  if ($("bookingDonorId")) $("bookingDonorId").value = lastDonorContext.donorId || "";
  if ($("bookingPhone") && lastDonorContext.phone && lastDonorContext.phone.length >= 9) $("bookingPhone").value = lastDonorContext.phone;
  if ($("bookingPrefillNote")) {
    $("bookingPrefillNote").style.display = "block";
    $("bookingPrefillNote").innerText = "ใส่ชื่อและ Donor ID ให้แล้ว หากเลือกจองเกล็ดเลือด สามารถเลือกวันและเวลาได้ต่อเลย";
  }
}

async function runForgotSearch() {
  const idDoc = cleanLookupText($("idDocForgot").value);
  const dobRaw = $("donorDobForgot").value;
  const dob = normalizePublicDobInput(dobRaw);
  const phoneLast4 = last4FromInput($("phoneLast4Forgot").value);
  const btn = $("btnForgotSearch");

  if (!idDoc || phoneLast4.length !== 4) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกเลขเอกสาร และเบอร์โทรศัพท์หรือ 4 ตัวท้ายให้ครบครับ", iconText:"!" });
    return;
  }
  if (!dob) {
    showModal({ title:"ตรวจสอบวันเกิด", message:"กรุณากรอกวันเกิดให้ครบ 8 หลัก และตรวจสอบว่าเป็นวันที่จริง ระบบรองรับทั้ง พ.ศ. และ ค.ศ.", iconText:"!" });
    return;
  }

  hideAllResults();
  showBusy(btn, true, "🔎 ค้นหา Donor ID", "กำลังค้นหา...");

  const { data, error } = await sb.rpc("forgot_donor_id", {
    p_id_document: idDoc,
    p_dob: dob,
    p_phone_last4: phoneLast4
  });

  showBusy(btn, false, "🔎 ค้นหา Donor ID", "กำลังค้นหา...");

  if (error) {
    showModal({ title:"เชื่อมต่อไม่ได้", message:error.message || "ไม่สามารถเชื่อมต่อระบบได้", iconText:"!" });
    return;
  }

  if (!data || !data.found) {
    $("notFoundCard").style.display = "block";
    return;
  }

  $("forgotDonorIdText").innerText = data.donorId || "-";
  $("forgotResult").style.display = "block";
}

function useForgotDonorIdForCheck() {
  const donorId = ($("forgotDonorIdText")?.innerText || "").trim();
  if (!donorId || donorId === "-") return;

  $("donorIdInput").value = donorId;
  $("donorDobCheck").value = $("donorDobForgot").value;
  $("phoneLast4Check").value = $("phoneLast4Forgot").value;
  switchMode("check");
  window.scrollTo(0, 0);
  showModal({
    title:"ใส่ Donor ID ให้แล้ว",
    message:"ตรวจสอบวันเกิดและเบอร์โทร แล้วกดตรวจสอบข้อมูลได้เลยครับ",
    iconText:"✓",
    type:"success"
  });
}

function normalizeContactEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidOptionalEmail(value) {
  const email = normalizeContactEmail(value);
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function buildMailtoHref(email, subject, body) {
  const target = normalizeContactEmail(email);
  if (!target) return "";
  return "mailto:" + encodeURIComponent(target) +
    "?subject=" + encodeURIComponent(subject || "CNMI Blood Donation") +
    "&body=" + encodeURIComponent(body || "");
}

function openReplyEmail(email, subject, body) {
  const href = buildMailtoHref(email, subject, body);
  if (!href) {
    showModal({ title:"ไม่มีอีเมล", message:"รายการนี้ไม่ได้ระบุอีเมลสำหรับติดต่อกลับ", iconText:"!" });
    return;
  }
  window.location.href = href;
}

async function triggerExternalNotification(sourceType, sourceId, eventType) {
  if (!sourceType || !sourceId) return;
  try {
    const { error } = await sb.functions.invoke("notify-donor-request", {
      body: { sourceType:String(sourceType), sourceId:String(sourceId), eventType:String(eventType || "new") }
    });
    if (error) console.warn("CNMI notification function:", error.message || error);
  } catch (err) {
    // Notification must never block a successfully saved booking/request.
    console.warn("CNMI notification function unavailable:", err);
  }
}

async function syncStaffPlannerEvent(sourceType, sourceId, eventType) {
  if (!sourceType || !sourceId) return;
  try {
    const { error } = await sb.functions.invoke("notify-donor-request", {
      body: {
        sourceType:String(sourceType),
        sourceId:String(sourceId),
        eventType:String(eventType || "sync"),
        syncOnly:true
      }
    });
    if (error) console.warn("CNMI Staff Planner sync:", error.message || error);
  } catch (err) {
    // Cross-app sync must never block the main Donor App workflow.
    console.warn("CNMI Staff Planner sync unavailable:", err);
  }
}

async function loadHomeRoomStatus() {
  const box = $("homeRoomStatus");
  if (!box) return;
  const copy = box.querySelector(".home-room-status-copy");
  const icon = box.querySelector(".home-room-status-icon i");
  if (!copy) return;
  const today = todayISO();
  try {
    const { data, error } = await sb.rpc("get_room_calendar", { p_month:today.slice(0,7) });
    if (error || !data || data.ok !== true || !data.published) {
      box.className = "home-room-status mb-3 status-neutral";
      copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>กรุณาตรวจสอบปฏิทิน</b><span>ตารางเดือนนี้ยังไม่ได้เผยแพร่ หรือกำลังปรับข้อมูล</span>';
      if (icon) icon.className = "bi bi-calendar2";
      return;
    }
    const events = Array.isArray(data.events) ? data.events : [];
    const e = events.find(x => x.date === today);
    if (!e) {
      box.className = "home-room-status mb-3 status-open";
      const hours = roomRegularHours(today);
      copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>เปิดรับลงทะเบียนตามปกติ</b><span>' + escapeHtml(hours.full) + ' · พักเที่ยง ' + escapeHtml(hours.breakTime) + ' น.</span>';
      if (icon) icon.className = "bi bi-check-circle";
      return;
    }
    const meta = roomEventMeta(e.type);
    const closed = e.type === "closed" || e.type === "mobile_unit";
    box.className = "home-room-status mb-3 " + (closed ? "status-closed" : (e.type === "limited" ? "status-limited" : "status-open"));
    const eventHours = roomHoursForEvent(today, e);
    const details = [e.title && e.title !== meta.label ? e.title : "", e.location, e.note].filter(Boolean).join(" · ");
    const timing = !closed && eventHours.show ? (eventHours.full + (eventHours.breakTime ? " · พักเที่ยง " + eventHours.breakTime + " น." : "")) : (eventHours.show ? eventHours.full : "");
    const statusLine = [timing, details].filter(Boolean).join(" · ") || (closed ? "กรุณาดูรายละเอียดในปฏิทิน" : "เปิดให้บริการตามประกาศ");
    copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>' + escapeHtml(meta.label) + '</b><span>' + escapeHtml(statusLine) + '</span>';
    if (icon) icon.className = "bi " + meta.icon;
  } catch (err) {
    box.className = "home-room-status mb-3 status-neutral";
    copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>ตรวจสอบไม่ได้ชั่วคราว</b><span>กดดูปฏิทินหรือติดต่อเจ้าหน้าที่</span>';
  }
}

function showDonationChoice() {
  showPage("donationChoice");
}
async function startPlateletScreening() {
  showPage("screening");
  await loadPublicScreeningQuestions();
  resetScreening();
}
async function loadPublicScreeningQuestions(force) {
  if (!force && screeningQuestionsLoadedAt && (Date.now() - screeningQuestionsLoadedAt) < 60000) return screeningQuestions;
  try {
    const { data, error } = await sb.from("screening_questions")
      .select("id,question_text,pass_answer,fail_message,gender,sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending:true })
      .order("created_at", { ascending:true });
    if (error) throw error;
    if (Array.isArray(data) && data.length) {
      screeningQuestions = data.map(function(row){
        return {
          id: row.id,
          text: row.question_text,
          passAnswer: row.pass_answer,
          failMessage: row.fail_message,
          gender: row.gender || undefined,
          sortOrder: row.sort_order
        };
      });
      screeningQuestionsLoadedAt = Date.now();
      return screeningQuestions;
    }
  } catch (err) {
    console.warn("screening questions fallback", err);
  }
  screeningQuestions = defaultScreeningQuestions.map(function(q){ return Object.assign({}, q); });
  screeningQuestionsLoadedAt = Date.now();
  return screeningQuestions;
}

function startScreening() { startPlateletScreening(); }
function resetScreening() {
  selectedGender = "";
  currentQuestionIndex = 0;
  $("genderCard").style.display = "block";
  $("questionCard").style.display = "none";
  $("genderMale").classList.remove("active");
  $("genderFemale").classList.remove("active");
}
function selectGender(gender) {
  selectedGender = gender;
  $("genderMale").classList.toggle("active", gender === "ชาย");
  $("genderFemale").classList.toggle("active", gender === "หญิง");
}
function getActiveQuestions() { return screeningQuestions.filter(q => !q.gender || q.gender === selectedGender); }
function beginQuestions() {
  if (!selectedGender) {
    showModal({ title:"กรุณาเลือกเพศ", message:"กรุณาเลือกเพศก่อนเริ่มทำแบบประเมินครับ", iconText:"!" });
    return;
  }
  currentQuestionIndex = 0;
  $("genderCard").style.display = "none";
  $("questionCard").style.display = "block";
  renderQuestion();
}
function renderQuestion() {
  const qs = getActiveQuestions();
  const q = qs[currentQuestionIndex];
  if (!q) { showPassAndGoBooking(); return; }
  $("questionText").innerText = q.text;
  $("questionCounter").innerText = "ข้อที่ " + (currentQuestionIndex + 1) + " / " + qs.length;
  $("screeningProgressBar").style.width = (((currentQuestionIndex + 1) / qs.length) * 100) + "%";
  $("answerYesBtn").classList.remove("active");
  $("answerNoBtn").classList.remove("active");
}
function answerQuestion(answer) {
  const qs = getActiveQuestions();
  const q = qs[currentQuestionIndex];
  if (!q) return;
  $("answerYesBtn").classList.toggle("active", answer === "yes");
  $("answerNoBtn").classList.toggle("active", answer === "no");
  setTimeout(function() {
    if (answer !== q.passAnswer) {
      showModal({
        title:"ยังไม่แนะนำให้จองคิวในขณะนี้",
        message:q.failMessage,
        iconText:"!",
        secondaryText:"กลับไปแก้ไข",
        primaryText:"รับทราบ",
        onSecondary:function(){ renderQuestion(); },
        onPrimary:function(){ showPage("home"); }
      });
      return;
    }
    currentQuestionIndex++;
    renderQuestion();
  }, 160);
}
function previousQuestion() {
  if (currentQuestionIndex > 0) { currentQuestionIndex--; renderQuestion(); }
  else { $("genderCard").style.display = "block"; $("questionCard").style.display = "none"; }
}
function showPassAndGoBooking() {
  showModal({
    title:"ผ่านการคัดกรองเบื้องต้น",
    message:"ผ่านการประเมินเบื้องต้น สามารถเลือกคิวบริจาคเกล็ดเลือดได้ครับ",
    iconText:"✓",
    type:"success",
    primaryText:"ไปหน้าจองคิว",
    onPrimary:function(){ showPage("booking"); }
  });
}

function selectSlot(btn, slot) {
  if (btn.classList.contains("full")) return;
  selectedSlot = slot;
  document.querySelectorAll(".slot-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

async function loadBookingSlots() {
  const bookingDate = $("bookingDate").value;
  const grid = $("bookingSlotGrid");
  selectedSlot = "";
  if (!bookingDate) {
    grid.innerHTML = '<div class="empty-state-inline">เลือกวันที่ก่อน แล้วช่วงเวลาที่ว่างจะแสดงตรงนี้</div>';
    return;
  }
  if (isWeekendISO(bookingDate)) {
    grid.innerHTML = '<div class="booking-day-closed"><i class="bi bi-calendar-x"></i><b>เสาร์–อาทิตย์ไม่เปิดรับจองเกล็ดเลือด</b><span>กรุณาเลือกวันจันทร์–ศุกร์</span></div>';
    return;
  }

  grid.innerHTML = '<div class="text-muted small" style="grid-column:1/-1;">กำลังโหลดช่วงเวลาที่ว่าง...</div>';
  const { data, error } = await sb.rpc("get_booking_slots", { p_booking_date: bookingDate });
  if (error || !data || !data.ok) {
    grid.innerHTML = '<div class="text-danger small" style="grid-column:1/-1;">' + escapeHtml(error?.message || data?.message || "ไม่สามารถโหลดช่วงเวลาได้") + '</div>';
    return;
  }
  if (!Array.isArray(data.slots) || data.slots.length === 0) {
    const msg = data.message || "วันที่เลือกยังไม่เปิดรับจอง";
    grid.innerHTML = '<div class="booking-day-closed"><i class="bi bi-calendar2-minus"></i><b>' + escapeHtml(msg) + '</b><span>เลือกวันอื่นที่เปิดรับจองได้เลย</span></div>';
    return;
  }
  renderBookingSlots(data.slots || []);
}

function renderBookingSlots(slots) {
  const grid = $("bookingSlotGrid");
  selectedSlot = "";
  if (!Array.isArray(slots) || slots.length === 0) {
    grid.innerHTML = '<div class="text-muted small" style="grid-column:1/-1;">ไม่พบช่วงเวลาที่เปิดให้จองในวันที่เลือก</div>';
    return;
  }
  grid.innerHTML = slots.map(function(slot) {
    const remaining = Number(slot.remaining || 0);
    const maxQueue = Number(slot.max || 2);
    const leadTimeClosed = slot.status === "ล่วงหน้าไม่ถึง 24 ชม.";
    const isFull = remaining <= 0 || slot.status === "ปิด" || leadTimeClosed;
    const cls = isFull ? "slot-btn full" : "slot-btn";
    const text = leadTimeClosed ? "ต้องจองล่วงหน้า 24 ชม." : (slot.status === "ปิด" ? "งดรับ" : (remaining <= 0 ? "เต็มแล้ว" : "ว่าง " + remaining + "/" + maxQueue));
    return '<button type="button" class="' + cls + '" onclick="selectSlot(this, \'' + escapeHtml(slot.time) + '\')"><b>' + escapeHtml(slot.time) + ' น.</b><br><span><i class="bi bi-people"></i> ' + text + '</span></button>';
  }).join("");
}

function getBookingQrUrl(qrToken) {
  const base = getAuthRedirectUrl().replace(/[#?].*$/, "");
  return base + "#manage?qr=" + encodeURIComponent(String(qrToken || "").trim());
}

function renderBookingSuccess(data, name) {
  lastBookingResult = {
    bookingId: data.bookingId || "",
    bookingCode: data.bookingCode || data.bookingId || "",
    qrToken: data.qrToken || "",
    bookingDate: data.bookingDate || "",
    timeSlot: data.timeSlot || "",
    name: name || ""
  };

  if ($("successBookingCode")) $("successBookingCode").innerText = lastBookingResult.bookingCode || "-";
  if ($("successBookingName")) $("successBookingName").innerText = lastBookingResult.name || "-";
  if ($("successBookingDate")) $("successBookingDate").innerText = isoToThaiDate(lastBookingResult.bookingDate, true);
  if ($("successBookingTime")) $("successBookingTime").innerText = (lastBookingResult.timeSlot || "-") + " น.";

  const qrBox = $("bookingQrCode");
  if (qrBox) {
    qrBox.innerHTML = "";
    if (lastBookingResult.qrToken && window.QRCode) {
      try {
        new QRCode(qrBox, {
          text: getBookingQrUrl(lastBookingResult.qrToken),
          width: 220,
          height: 220,
          colorDark: "#1f2933",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (err) {
        qrBox.innerHTML = '<div class="qr-fallback"><i class="bi bi-exclamation-circle"></i><span>สร้าง QR ไม่สำเร็จ<br>กรุณาเก็บเลขนัดหมายไว้</span></div>';
      }
    } else {
      qrBox.innerHTML = '<div class="qr-fallback"><i class="bi bi-wifi-off"></i><span>ยังโหลดตัวสร้าง QR ไม่สำเร็จ<br>เลขนัดหมายยังใช้งานได้ตามปกติ</span></div>';
    }
  }
  showPage("bookingSuccess");
}

async function copyBookingCode() {
  if (!lastBookingResult || !lastBookingResult.bookingCode) return;
  try {
    await navigator.clipboard.writeText(lastBookingResult.bookingCode);
    showModal({ title:"คัดลอกแล้ว", message:"คัดลอกเลขนัดหมาย " + lastBookingResult.bookingCode + " แล้ว", iconText:"✓", type:"success" });
  } catch (err) {
    showModal({ title:"เลขนัดหมาย", message:lastBookingResult.bookingCode, iconText:"#" });
  }
}

function getQrDataUrl() {
  const box = $("bookingQrCode");
  if (!box) return "";
  const canvas = box.querySelector("canvas");
  if (canvas && canvas.toDataURL) return canvas.toDataURL("image/png");
  const img = box.querySelector("img");
  return img ? (img.src || "") : "";
}

function downloadBookingQr() {
  if (!lastBookingResult) return;
  const url = getQrDataUrl();
  if (!url) {
    showModal({ title:"ยังบันทึก QR ไม่ได้", message:"กรุณารอให้ QR แสดงครบก่อน หรือใช้เลขนัดหมายแทน", iconText:"!" });
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = "CNMI-Platelet-" + (lastBookingResult.bookingCode || "booking") + ".png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function shareBooking() {
  if (!lastBookingResult) return;
  const text = "CNMI Blood Donation\nเลขนัดหมาย: " + lastBookingResult.bookingCode +
    "\nวันที่: " + isoToThaiDate(lastBookingResult.bookingDate, true) +
    "\nเวลา: " + lastBookingResult.timeSlot + " น.";
  const url = lastBookingResult.qrToken ? getBookingQrUrl(lastBookingResult.qrToken) : getAuthRedirectUrl();
  if (navigator.share) {
    try { await navigator.share({ title:"นัดหมายบริจาคเกล็ดเลือด CNMI", text:text, url:url }); return; } catch (err) { if (err && err.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text + "\n" + url);
    showModal({ title:"คัดลอกข้อมูลนัดหมายแล้ว", message:"สามารถนำไปวางใน LINE หรือแอปอื่นได้เลย", iconText:"✓", type:"success" });
  } catch (err) {
    showModal({ title:"ข้อมูลนัดหมาย", message:text, iconText:"✓", type:"success" });
  }
}

function extractQrToken(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const direct = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(text);
  if (direct) return direct[0];
  const match = /(?:[?#&]|^)qr=([0-9a-f-]{36})(?:&|$)/i.exec(text);
  return match ? match[1] : "";
}

async function loadBookingFromQrToken(qrToken) {
  const token = extractQrToken(qrToken) || String(qrToken || "").trim();
  if (!token) {
    showModal({ title:"อ่าน QR ไม่ได้", message:"QR นี้ไม่ใช่ QR นัดหมายของ CNMI", iconText:"!" });
    return false;
  }
  $("manageResult").style.display = "none";
  $("manageNotFoundCard").style.display = "none";
  currentManageBooking = null;

  const { data, error } = await sb.rpc("find_booking_by_qr", { p_qr_token: token });
  if (error || !data || !data.found) {
    $("manageNotFoundCard").style.display = "block";
    return false;
  }

  const displayCode = data.bookingCode || data.bookingId || "-";
  currentManageBooking = { bookingId:data.bookingId || displayCode, bookingCode:displayCode, phoneLast4:"", status:data.status || "", qrToken:token };
  if ($("manageBookingId")) $("manageBookingId").value = displayCode;
  if ($("managePhoneLast4")) $("managePhoneLast4").value = "";
  $("manageDisplayBookingId").innerText = displayCode;
  $("manageDisplayName").innerText = data.name || "-";
  $("manageDisplayDateTime").innerText = isoToThaiDate(data.bookingDate, true) + " เวลา " + (data.timeSlot || "-");
  $("manageDisplayStatus").innerText = data.status || "-";
  $("btnCancelBooking").style.display = (data.status || "") === "ยกเลิก" ? "none" : "block";
  $("manageResult").style.display = "block";
  showPage("manage");
  return true;
}

function chooseQrImage() {
  const input = $("qrImageFile");
  if (!input) return;
  input.value = "";
  input.click();
}

function setQrImageStatus(message, state) {
  const box = $("qrImageStatus");
  if (!box) return;
  if (!message) {
    box.style.display = "none";
    box.className = "qr-image-status";
    box.innerText = "";
    return;
  }
  box.style.display = "flex";
  box.className = "qr-image-status" + (state ? " " + state : "");
  box.innerHTML = '<i class="bi ' + (state === "success" ? "bi-check-circle" : state === "error" ? "bi-exclamation-circle" : "bi-image") + '"></i><span>' + escapeHtml(message) + '</span>';
}

async function handleQrImageSelection(event) {
  const input = event && event.target ? event.target : $("qrImageFile");
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) return;

  if (!file.type || !file.type.startsWith("image/")) {
    setQrImageStatus("กรุณาเลือกรูปภาพที่มี QR Code", "error");
    return;
  }

  setQrImageStatus("กำลังอ่าน QR Code จากรูป...", "loading");

  // หากเปิดกล้องค้างอยู่ ให้ปิดก่อนอ่านรูป เพื่อไม่ให้กล้องแย่ง resource บนมือถือ
  if (activeQrScanner) {
    await closeQrScanner();
  }

  if (!window.Html5Qrcode) {
    setQrImageStatus("อุปกรณ์นี้ยังอ่าน QR จากรูปไม่ได้ กรุณากรอกเลขนัดหมายแทน", "error");
    return;
  }

  try {
    if (imageQrScanner) {
      try { await imageQrScanner.clear(); } catch (e) {}
      imageQrScanner = null;
    }

    imageQrScanner = new Html5Qrcode("qrImageReader");
    const decodedText = await imageQrScanner.scanFile(file, false);
    const token = extractQrToken(decodedText);

    try { await imageQrScanner.clear(); } catch (e) {}
    imageQrScanner = null;

    if (!token) {
      setQrImageStatus("พบ QR Code แต่ไม่ใช่นัดหมายของ CNMI", "error");
      return;
    }

    setQrImageStatus("อ่าน QR Code สำเร็จ กำลังเปิดนัดหมาย...", "success");
    const found = await loadBookingFromQrToken(token);
    if (!found) setQrImageStatus("ไม่พบนัดหมายจาก QR Code นี้", "error");
  } catch (err) {
    if (imageQrScanner) {
      try { await imageQrScanner.clear(); } catch (e) {}
      imageQrScanner = null;
    }
    setQrImageStatus("อ่าน QR Code จากรูปไม่สำเร็จ ลองเลือกรูปที่เห็น QR ชัดและไม่เบลอ", "error");
  } finally {
    if (input) input.value = "";
  }
}

async function openQrScanner() {
  const overlay = $("qrScannerOverlay");
  const status = $("qrScannerStatus");
  if (!overlay) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  if (status) status.innerText = "กำลังเปิดกล้อง...";

  if (!window.Html5Qrcode) {
    if (status) status.innerText = "อุปกรณ์นี้ยังเปิดตัวสแกนไม่ได้ กรุณาใช้กล้องโทรศัพท์สแกน QR หรือกรอกเลขนัดหมาย";
    return;
  }

  try {
    if (activeQrScanner) { try { await activeQrScanner.stop(); } catch (e) {} try { await activeQrScanner.clear(); } catch (e) {} }
    activeQrScanner = new Html5Qrcode("qrReader");
    await activeQrScanner.start(
      { facingMode:"environment" },
      { fps:10, qrbox:{ width:240, height:240 }, aspectRatio:1.0 },
      async function(decodedText) {
        const token = extractQrToken(decodedText);
        if (!token) {
          if (status) status.innerText = "พบ QR แต่ไม่ใช่นัดหมาย CNMI";
          return;
        }
        if (status) status.innerText = "อ่าน QR สำเร็จ";
        await closeQrScanner();
        await loadBookingFromQrToken(token);
      },
      function() {}
    );
    if (status) status.innerText = "วาง QR ให้อยู่กลางกรอบ";
  } catch (err) {
    if (status) status.innerText = "เปิดกล้องไม่ได้ กรุณาอนุญาต Camera หรือใช้กล้องโทรศัพท์สแกน QR";
  }
}

async function closeQrScanner() {
  const overlay = $("qrScannerOverlay");
  if (activeQrScanner) {
    try { await activeQrScanner.stop(); } catch (err) {}
    try { await activeQrScanner.clear(); } catch (err) {}
    activeQrScanner = null;
  }
  if (overlay) {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }
}

async function submitBooking() {
  const name = $("bookingName").value.trim();
  const donorId = $("bookingDonorId").value.trim();
  const phone = onlyDigits($("bookingPhone").value);
  const email = normalizeContactEmail($("bookingEmail")?.value || "");
  const bookingDate = $("bookingDate").value;
  const btn = $("btnConfirmBooking");

  if (!name || phone.length < 9 || !bookingDate || !selectedSlot) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกชื่อ เบอร์โทร วันที่ และเลือกช่วงเวลาให้ครบครับ", iconText:"!" });
    return;
  }
  if (!isValidOptionalEmail(email)) {
    showModal({ title:"ตรวจสอบอีเมล", message:"รูปแบบอีเมลไม่ถูกต้อง หากไม่ต้องการใช้อีเมลสามารถเว้นว่างได้", iconText:"!" });
    return;
  }

  showBusy(btn, true, "ยืนยันการจอง", "กำลังบันทึกการจอง...");
  const { data, error } = await sb.rpc("create_booking", {
    p_name: name,
    p_donor_id: donorId,
    p_phone: phone,
    p_email: email,
    p_booking_date: bookingDate,
    p_time_slot: selectedSlot,
    p_donation_type: "Platelet"
  });
  showBusy(btn, false, "ยืนยันการจอง", "กำลังบันทึกการจอง...");

  if (error || !data || !data.ok) {
    showModal({ title:"ไม่สามารถจองคิวได้", message:error?.message || data?.message || "กรุณาลองใหม่ครับ", iconText:"!" });
    loadBookingSlots();
    return;
  }

  renderBookingSuccess(data, name);
  triggerExternalNotification("platelet", data.bookingId || data.bookingCode, "new");
  $("bookingName").value = "";
  $("bookingDonorId").value = "";
  $("bookingPhone").value = "";
  if ($("bookingEmail")) $("bookingEmail").value = "";
  selectedSlot = "";
  if ($("bookingPrefillNote")) $("bookingPrefillNote").style.display = "none";
  lastDonorContext = null;
  loadBookingSlots();
}

async function submitGroupBookingRequest() {
  const groupName = $("groupName").value.trim();
  const requestedDate = $("groupDate").value;
  const estimatedPeople = Number($("groupCount").value || 0);
  const coordinator = $("groupCoordinator").value.trim();
  const phone = onlyDigits($("groupPhone").value);
  const email = normalizeContactEmail($("groupEmail")?.value || "");
  const note = $("groupNote").value.trim();
  const btn = $("btnSubmitGroupRequest");

  if (!groupName || !requestedDate || estimatedPeople <= 10 || !coordinator || phone.length < 9) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกชื่อกลุ่ม วันที่ จำนวนมากกว่า 10 คน ชื่อผู้ประสานงาน และเบอร์โทรให้ครบ", iconText:"!" });
    return;
  }
  if (!isValidOptionalEmail(email)) {
    showModal({ title:"ตรวจสอบอีเมล", message:"รูปแบบอีเมลไม่ถูกต้อง หากไม่ต้องการใช้อีเมลสามารถเว้นว่างได้", iconText:"!" });
    return;
  }
  showBusy(btn, true, "ส่งคำขอนัดหมาย", "กำลังส่งคำขอ...");
  const { data, error } = await sb.rpc("create_group_booking_request", {
    p_group_name: groupName,
    p_requested_date: requestedDate,
    p_estimated_people: estimatedPeople,
    p_coordinator_name: coordinator,
    p_phone: phone,
    p_email: email,
    p_note: note
  });
  showBusy(btn, false, "ส่งคำขอนัดหมาย", "กำลังส่งคำขอ...");

  if (error || !data || data.ok !== true) {
    showModal({ title:"ส่งคำขอไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }

  triggerExternalNotification("group", data.requestId, "new");
  showModal({
    title:"ส่งคำขอเรียบร้อยแล้ว",
    message:"เลขที่คำขอ: " + data.requestId + "\nวันที่ต้องการ: " + isoToThaiDate(data.requestedDate, true) + "\nจำนวนประมาณ " + estimatedPeople + " คน\n\nเจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันนัดหมาย",
    iconText:"✓", type:"success",
    onPrimary:function(){ showPage("home"); }
  });
  ["groupName","groupCount","groupCoordinator","groupPhone","groupEmail","groupNote"].forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("groupDate")) $("groupDate").value = "";
  if ($("groupSelectedDate")) {
    $("groupSelectedDate").classList.remove("selected");
    $("groupSelectedDate").innerHTML = '<i class="bi bi-calendar-check"></i><span>กรุณาเลือกวันที่จากตารางด้านบน</span>';
  }
  document.querySelectorAll(".group-public-day.selected").forEach(el => el.classList.remove("selected"));
}


async function submitMobileUnitRequest() {
  const organizationName = $("mobileUnitOrg")?.value.trim() || "";
  const preferredDate = $("mobileUnitDate")?.value || "";
  const estimatedPeople = Number($("mobileUnitCount")?.value || 0);
  const coordinator = $("mobileUnitCoordinator")?.value.trim() || "";
  const phone = onlyDigits($("mobileUnitPhone")?.value || "");
  const email = normalizeContactEmail($("mobileUnitEmail")?.value || "");
  const locationText = $("mobileUnitLocation")?.value.trim() || "";
  const note = $("mobileUnitNote")?.value.trim() || "";
  const btn = $("btnSubmitMobileUnitRequest");

  if (!organizationName || !preferredDate || estimatedPeople < 40 || !coordinator || phone.length < 9 || !locationText) {
    showModal({
      title:"กรอกข้อมูลไม่ครบ",
      message:"กรุณากรอกหน่วยงาน วันที่ จำนวนอย่างน้อย 40 คน สถานที่ ผู้ประสานงาน และเบอร์โทรให้ครบ",
      iconText:"!"
    });
    return;
  }
  if (!isValidOptionalEmail(email)) {
    showModal({ title:"ตรวจสอบอีเมล", message:"รูปแบบอีเมลไม่ถูกต้อง หากไม่ต้องการใช้อีเมลสามารถเว้นว่างได้", iconText:"!" });
    return;
  }

  showBusy(btn, true, "ส่งคำขอให้ติดต่อกลับ", "กำลังส่งคำขอ...");
  const { data, error } = await sb.rpc("create_mobile_unit_request", {
    p_organization_name: organizationName,
    p_estimated_people: estimatedPeople,
    p_preferred_date: preferredDate,
    p_coordinator_name: coordinator,
    p_phone: phone,
    p_email: email,
    p_location_text: locationText,
    p_note: note
  });
  showBusy(btn, false, "ส่งคำขอให้ติดต่อกลับ", "กำลังส่งคำขอ...");

  if (error || !data || data.ok !== true) {
    showModal({
      title:"ส่งคำขอไม่สำเร็จ",
      message:error?.message || data?.message || "กรุณาลองใหม่",
      iconText:"!"
    });
    return;
  }

  triggerExternalNotification("mobile", data.requestId, "new");

  showModal({
    title:"ส่งคำขอเรียบร้อยแล้ว",
    message:"เลขที่คำขอ: " + data.requestId +
      "\nวันที่ที่ต้องการ: " + isoToThaiDate(data.preferredDate, true) +
      "\nจำนวนประมาณ " + estimatedPeople + " คน" +
      "\n\nเจ้าหน้าที่จะติดต่อกลับเพื่อประสานรายละเอียดและยืนยันความพร้อม",
    iconText:"✓",
    type:"success",
    onPrimary:function(){ showPage("home"); }
  });

  ["mobileUnitOrg","mobileUnitCount","mobileUnitCoordinator","mobileUnitPhone","mobileUnitEmail","mobileUnitLocation","mobileUnitNote"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  if ($("mobileUnitDate")) $("mobileUnitDate").value = "";
}

function clearManageBooking() {
  $("manageBookingId").value = "";
  $("managePhoneLast4").value = "";
  $("manageResult").style.display = "none";
  $("manageNotFoundCard").style.display = "none";
  currentManageBooking = null;
}

async function findBookingUI() {
  const bookingId = $("manageBookingId").value.trim();
  const phoneLast4 = onlyDigits($("managePhoneLast4").value);
  const btn = $("btnFindBooking");

  if (!bookingId || phoneLast4.length !== 4) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกเลขนัดหมายและเบอร์โทรศัพท์ 4 ตัวท้ายให้ครบ", iconText:"!" });
    return;
  }

  $("manageResult").style.display = "none";
  $("manageNotFoundCard").style.display = "none";
  currentManageBooking = null;
  showBusy(btn, true, "🔍 ตรวจสอบนัดหมาย", "กำลังตรวจสอบ...");

  const { data, error } = await sb.rpc("find_booking", { p_booking_id: bookingId, p_phone_last4: phoneLast4 });
  showBusy(btn, false, "🔍 ตรวจสอบนัดหมาย", "กำลังตรวจสอบ...");

  if (error || !data || !data.found) {
    $("manageNotFoundCard").style.display = "block";
    return;
  }

  const displayCode = data.bookingCode || data.bookingId || bookingId;
  currentManageBooking = { bookingId:data.bookingId || bookingId, bookingCode:displayCode, phoneLast4, status:data.status || "" };
  $("manageDisplayBookingId").innerText = displayCode || "-";
  $("manageDisplayName").innerText = data.name || "-";
  $("manageDisplayDateTime").innerText = isoToThaiDate(data.bookingDate, true) + " เวลา " + (data.timeSlot || "-");
  $("manageDisplayStatus").innerText = data.status || "-";
  $("btnCancelBooking").style.display = (data.status || "") === "ยกเลิก" ? "none" : "block";
  $("manageResult").style.display = "block";
}

function confirmCancelBooking() {
  if (!currentManageBooking) {
    showModal({ title:"ไม่พบรายการจอง", message:"กรุณาตรวจสอบนัดหมายก่อนยกเลิก", iconText:"!" });
    return;
  }
  const enteredLast4 = onlyDigits($("managePhoneLast4")?.value || currentManageBooking.phoneLast4 || "");
  if (enteredLast4.length !== 4) {
    showModal({ title:"ยืนยันก่อนยกเลิก", message:"กรุณากรอกเบอร์โทร 4 ตัวท้ายก่อนยกเลิกนัดหมาย", iconText:"!" });
    return;
  }
  currentManageBooking.phoneLast4 = enteredLast4;
  showModal({
    title:"ยืนยันการยกเลิกนัดหมาย",
    message:"ต้องการยกเลิกนัดหมาย " + (currentManageBooking.bookingCode || currentManageBooking.bookingId) + " ใช่หรือไม่",
    iconText:"!",
    secondaryText:"กลับไปตรวจสอบ",
    primaryText:"ยืนยันยกเลิก",
    onPrimary:function(){ cancelBookingUI(); }
  });
}

async function cancelBookingUI() {
  const btn = $("btnCancelBooking");
  showBusy(btn, true, "ยกเลิกนัดหมายนี้", "กำลังยกเลิก...");
  const { data, error } = await sb.rpc("cancel_booking", {
    p_booking_id: currentManageBooking.bookingId,
    p_phone_last4: currentManageBooking.phoneLast4
  });
  showBusy(btn, false, "ยกเลิกนัดหมายนี้", "กำลังยกเลิก...");

  if (error || !data || !data.ok) {
    showModal({ title:"ยกเลิกไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่ครับ", iconText:"!" });
    return;
  }

  syncStaffPlannerEvent("platelet", currentManageBooking.bookingId, "cancel");

  showModal({
    title:"ยกเลิกนัดหมายสำเร็จ",
    message:"ระบบได้ยกเลิกนัดหมาย " + (currentManageBooking.bookingCode || currentManageBooking.bookingId) + " แล้ว",
    iconText:"✓",
    type:"success",
    onPrimary:function(){ findBookingUI(); loadBookingSlots(); }
  });
}

async function showStaffGate() {
  const ok = await ensureStaff(false);
  if (ok) routeStaffAfterAuth();
  else showPage("staffLogin");
}

async function staffLogin() {
  const email = normalizeStaffEmail($("staffEmail").value);
  const password = $("staffPassword").value;
  const btn = $("btnStaffLogin");
  if (!email || !password) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอก email และ password", iconText:"!" });
    return;
  }

  showBusy(btn, true, "เข้าสู่ระบบ", "กำลังเข้าสู่ระบบ...");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  showBusy(btn, false, "เข้าสู่ระบบ", "กำลังเข้าสู่ระบบ...");
  if (error) {
    showModal({ title:"เข้าสู่ระบบไม่สำเร็จ", message:error.message, iconText:"!" });
    return;
  }

  const ok = await ensureStaff(true);
  if (ok) routeStaffAfterAuth();
}

function toggleStaffPanel(panel) {
  const firstPanel = $("firstTimePanel");
  const forgotPanel = $("forgotPasswordPanel");
  const loginEmail = normalizeStaffEmail($("staffEmail") ? $("staffEmail").value : "");

  if (panel === "first") {
    if (firstPanel) {
      const willOpen = firstPanel.style.display === "none" || firstPanel.style.display === "";
      firstPanel.style.display = willOpen ? "block" : "none";
      if (willOpen && loginEmail && $("firstEmail") && !$("firstEmail").value) $("firstEmail").value = loginEmail;
    }
    if (forgotPanel) forgotPanel.style.display = "none";
    return;
  }

  if (panel === "forgot") {
    if (forgotPanel) {
      const willOpen = forgotPanel.style.display === "none" || forgotPanel.style.display === "";
      forgotPanel.style.display = willOpen ? "block" : "none";
      if (willOpen && loginEmail && $("resetEmail") && !$("resetEmail").value) $("resetEmail").value = loginEmail;
    }
    if (firstPanel) firstPanel.style.display = "none";
  }
}

async function staffFirstTimeSignup() {
  const displayName = String($("firstDisplayName").value || "").trim();
  const email = normalizeStaffEmail($("firstEmail").value);
  const password = $("firstPassword").value;
  const password2 = $("firstPassword2").value;
  const btn = $("btnFirstSignup");

  if (!displayName || !email || !password || !password2) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกชื่อ Email และ Password ให้ครบ", iconText:"!" });
    return;
  }
  if (!isAllowedStaffEmail(email)) {
    showModal({ title:"Email ไม่ถูกต้อง", message:"กรุณาใช้ email @" + (CONFIG.STAFF_EMAIL_DOMAIN || "mahidol.ac.th"), iconText:"!" });
    return;
  }
  if (password.length < 8) {
    showModal({ title:"Password สั้นเกินไป", message:"กรุณาตั้ง Password อย่างน้อย 8 ตัวอักษร", iconText:"!" });
    return;
  }
  if (password !== password2) {
    showModal({ title:"Password ไม่ตรงกัน", message:"กรุณากรอก Password ทั้งสองช่องให้ตรงกัน", iconText:"!" });
    return;
  }

  showBusy(btn, true, "สร้างบัญชี / ตั้งรหัสผ่าน", "กำลังสร้างบัญชี...");
  const { data, error } = await sb.auth.signUp({
    email: email,
    password: password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: getAuthRedirectUrl()
    }
  });
  showBusy(btn, false, "สร้างบัญชี / ตั้งรหัสผ่าน", "กำลังสร้างบัญชี...");

  if (error) {
    showModal({ title:"สร้างบัญชีไม่สำเร็จ", message:error.message, iconText:"!" });
    return;
  }

  // ถ้า Supabase ปิด email confirmation จะมี session ทันที
  if (data && data.session) {
    const ok = await ensureStaff(true);
    if (ok) {
      showModal({ title:"สร้างบัญชีสำเร็จ", message:"เข้าสู่ระบบหลังบ้านเรียบร้อยแล้ว", iconText:"✓", type:"success", onPrimary:function(){ showPage("staff"); } });
    }
    return;
  }

  showModal({
    title:"ส่งอีเมลยืนยันแล้ว",
    message:"กรุณาเปิดอีเมล " + email + " แล้วกดลิงก์ยืนยัน จากนั้นกลับมาเข้าสู่ระบบด้วยรหัสที่ตั้งไว้",
    iconText:"✓",
    type:"success"
  });
}

async function sendPasswordResetEmail(email, box, btn, normalText) {
  email = normalizeStaffEmail(email);
  if (!email) {
    if (box) setStaffResult(box, "กรุณากรอก Email", false);
    return false;
  }
  if (!isAllowedStaffEmail(email)) {
    if (box) setStaffResult(box, "กรุณาใช้ email @" + (CONFIG.STAFF_EMAIL_DOMAIN || "mahidol.ac.th"), false);
    return false;
  }

  showBusy(btn, true, normalText, "กำลังส่งอีเมล...");
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl()
  });
  showBusy(btn, false, normalText, "กำลังส่งอีเมล...");

  if (error) {
    if (box) setStaffResult(box, "ส่งอีเมลไม่สำเร็จ\n" + error.message, false);
    return false;
  }

  if (box) {
    setStaffResult(box, "ส่งอีเมลตั้งรหัสผ่านใหม่แล้ว\n\nให้เจ้าหน้าที่เปิดอีเมล แล้วกดลิงก์เพื่อตั้งรหัสใหม่เอง", true);
  }
  return true;
}

async function sendPasswordResetSelf() {
  await sendPasswordResetEmail($("resetEmail").value, $("passwordResetRequestResult"), $("btnSendReset"), "ส่งอีเมลตั้งรหัสใหม่");
}

async function updatePasswordFromRecovery() {
  const password = $("newPassword").value;
  const password2 = $("newPassword2").value;
  const btn = $("btnUpdatePassword");
  const box = $("updatePasswordResult");

  if (!password || !password2) { setStaffResult(box, "กรุณากรอก Password ใหม่ทั้งสองช่อง", false); return; }
  if (password.length < 8) { setStaffResult(box, "กรุณาตั้ง Password อย่างน้อย 8 ตัวอักษร", false); return; }
  if (password !== password2) { setStaffResult(box, "Password ทั้งสองช่องไม่ตรงกัน", false); return; }

  showBusy(btn, true, "บันทึกรหัสผ่านใหม่", "กำลังบันทึก...");
  const { error } = await sb.auth.updateUser({ password: password });
  showBusy(btn, false, "บันทึกรหัสผ่านใหม่", "กำลังบันทึก...");

  if (error) { setStaffResult(box, "บันทึกไม่สำเร็จ\n" + error.message, false); return; }

  setStaffResult(box, "ตั้งรหัสผ่านใหม่สำเร็จแล้ว", true);
  const ok = await ensureStaff(false);
  if (ok) {
    setTimeout(function(){ showPage("staff"); }, 700);
  } else {
    setTimeout(function(){ showPage("staffLogin"); }, 700);
  }
}

async function ensureStaff(showError) {
  const { data: userData } = await sb.auth.getUser();
  if (!userData || !userData.user) return false;

  const { data: syncData, error: syncError } = await sb.rpc("sync_my_staff_profile");
  if (syncError || !syncData || syncData.ok !== true) {
    await sb.auth.signOut();
    if (showError) showModal({ title:"ไม่มีสิทธิ์เจ้าหน้าที่", message:"บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานหลังบ้าน กรุณาให้แอดมินเพิ่ม email ในเมนูจัดการเจ้าหน้าที่ก่อน", iconText:"!" });
    return false;
  }

  currentStaffProfile = syncData.profile || null;
  applyStaffProfileUI();
  return true;
}

function routeStaffAfterAuth() {
  if (currentStaffProfile && currentStaffProfile.must_change_password) {
    showPage("staffChangePassword");
    return;
  }
  showPage("staff", { skipRoute:true });
  showStaffTab(pendingStaffRouteTab || "overview");
  if ((pendingStaffRouteTab || "overview") === "questions" && pendingStaffQuestionCode) {
    setTimeout(function(){ openStaffQuestionByPublicCode(pendingStaffQuestionCode); }, 220);
  }
}

async function changeTemporaryPassword() {
  const password = $("tempNewPassword").value;
  const password2 = $("tempNewPassword2").value;
  const btn = $("btnChangeTempPassword");
  const box = $("changeTempPasswordResult");

  if (!password || !password2) { setStaffResult(box, "กรุณากรอก Password ใหม่ทั้งสองช่อง", false); return; }
  if (password.length < 8) { setStaffResult(box, "กรุณาตั้ง Password อย่างน้อย 8 ตัวอักษร", false); return; }
  if (password !== password2) { setStaffResult(box, "Password ทั้งสองช่องไม่ตรงกัน", false); return; }

  showBusy(btn, true, "บันทึกรหัสผ่านใหม่", "กำลังบันทึก...");
  const { error } = await sb.auth.updateUser({ password: password });
  if (error) {
    showBusy(btn, false, "บันทึกรหัสผ่านใหม่", "กำลังบันทึก...");
    setStaffResult(box, "บันทึกรหัสผ่านใหม่ไม่สำเร็จ\n" + error.message, false);
    return;
  }

  const { data, error: markError } = await sb.rpc("mark_my_password_changed");
  showBusy(btn, false, "บันทึกรหัสผ่านใหม่", "กำลังบันทึก...");

  if (markError || !data || data.ok !== true) {
    setStaffResult(box, "บันทึกรหัสแล้ว แต่ปรับสถานะใช้งานครั้งแรกไม่สำเร็จ\nกรุณาแจ้งแอดมิน", false);
    return;
  }

  setStaffResult(box, "เปลี่ยนรหัสผ่านสำเร็จแล้ว กำลังเข้าสู่ระบบเจ้าหน้าที่...", true);
  await ensureStaff(false);
  setTimeout(function(){ showPage("staff"); }, 600);
}

function getEffectiveStaffRole() {
  if (!currentStaffProfile) return "staff";
  if (currentStaffProfile.role === "admin" && staffViewMode === "staff") return "staff";
  return currentStaffProfile.role || "staff";
}

function isAdminView() {
  return !!currentStaffProfile && currentStaffProfile.role === "admin" && getEffectiveStaffRole() === "admin";
}

function applyStaffProfileUI() {
  const profile = currentStaffProfile || {};
  const actualAdmin = profile.role === "admin";
  const effectiveRole = getEffectiveStaffRole();
  const bar = $("staffProfileBar");
  if (bar) {
    bar.style.display = "block";
    const modeText = actualAdmin && effectiveRole === "staff" ? " · กำลังดูแบบ Staff" : " · " + effectiveRole;
    bar.innerText = (profile.display_name || profile.email || "เจ้าหน้าที่") + modeText + (profile.must_change_password ? " · ต้องเปลี่ยนรหัสผ่าน" : "");
    bar.classList.toggle("staff-preview-mode", actualAdmin && effectiveRole === "staff");
  }
  const adminBtn = $("staffTabBtn_admin");
  if (adminBtn) adminBtn.style.display = isAdminView() ? "block" : "none";
  const adminGroup = document.querySelector('.staff-nav-group[data-nav-group="admin"]');
  if (adminGroup) adminGroup.style.display = isAdminView() ? "block" : "none";
  document.querySelectorAll('#staffMenuLauncher .admin-only').forEach(function(el){
    el.style.display = isAdminView() ? "block" : "none";
  });

  const switchBtn = $("staffRoleSwitchBtn");
  if (switchBtn) {
    switchBtn.style.display = actualAdmin ? "inline-flex" : "none";
    const span = switchBtn.querySelector("span");
    if (span) span.innerText = effectiveRole === "staff" ? "กลับ Admin" : "ดูแบบ Staff";
    switchBtn.classList.toggle("active", effectiveRole === "staff");
  }
}

function toggleAdminStaffView() {
  if (!currentStaffProfile || currentStaffProfile.role !== "admin") return;
  const goingStaff = getEffectiveStaffRole() === "admin";
  staffViewMode = goingStaff ? "staff" : null;
  applyStaffProfileUI();

  const activeAdminPage = $("staffTab_admin") && $("staffTab_admin").classList.contains("active");
  if (goingStaff && activeAdminPage) showStaffTab("overview");
  else loadStaffDashboard();

  showModal({
    title: goingStaff ? "เปลี่ยนเป็นมุมมอง Staff แล้ว" : "กลับสู่มุมมอง Admin แล้ว",
    message: goingStaff
      ? "เมนูและคำสั่ง Admin ถูกปิดจากหน้าจอนี้ชั่วคราว เพื่อให้ตรวจดูสิ่งที่เจ้าหน้าที่ทั่วไปเห็นได้"
      : "สิทธิ์และเมนู Admin กลับมาแสดงตามปกติ",
    iconText: goingStaff ? "S" : "A",
    type:"success"
  });
}

async function requireAdmin() {
  const ok = await ensureStaff(true);
  if (!ok) return false;
  if (currentStaffProfile && currentStaffProfile.must_change_password) {
    showPage("staffChangePassword");
    return false;
  }
  if (!isAdminView()) {
    showModal({ title:"ไม่มีสิทธิ์ Admin ในมุมมองนี้", message:"ขณะนี้กำลังใช้งานแบบ Staff กรุณากด “กลับ Admin” ก่อนใช้เมนูผู้ดูแลระบบ", iconText:"!" });
    return false;
  }
  return true;
}

async function staffLogout() {
  await sb.auth.signOut();
  currentStaffProfile = null;
  staffViewMode = null;
  showPage("home");
}

function toggleStaffNavGroup(groupId, forceOpen) {
  const group = document.querySelector('.staff-nav-group[data-nav-group="' + groupId + '"]');
  if (!group) return;
  const nextOpen = typeof forceOpen === "boolean" ? forceOpen : !group.classList.contains("open");
  document.querySelectorAll('.staff-nav-group').forEach(function(item){
    item.classList.toggle("open", nextOpen && item === group);
  });
}

function openStaffMenuLauncher() {
  const overlay = $("staffMenuLauncher");
  if (!overlay) return;
  applyStaffProfileUI();
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("staff-menu-open");
}

function closeStaffMenuLauncher() {
  const overlay = $("staffMenuLauncher");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("staff-menu-open");
}

function goStaffMenu(tab) {
  closeStaffMenuLauncher();
  showStaffTab(tab);
}

function openStaffNavGroupForTab(tab) {
  const groupId = STAFF_TAB_GROUP_MAP[tab] || "today";
  document.querySelectorAll('.staff-nav-group').forEach(function(group){
    const id = group.dataset.navGroup || "";
    const shouldOpen = id === groupId || (id === "today" && tab === "overview");
    group.classList.toggle("open", shouldOpen);
  });
}

function showStaffTab(tab, options) {
  options = options || {};
  if (tab === "admin" && !isAdminView()) {
    showModal({ title:"ไม่มีสิทธิ์ Admin ในมุมมองนี้", message:"หากเป็น Admin กรุณากด “กลับ Admin” ก่อน", iconText:"!" });
    return;
  }
  document.querySelectorAll(".staff-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.staffTab === tab));
  openStaffNavGroupForTab(tab);
  document.querySelectorAll(".staff-tab-page").forEach(page => page.classList.remove("active"));
  const target = $("staffTab_" + tab);
  if (target) target.classList.add("active");
  pendingStaffRouteTab = tab || "overview";
  if (!options.skipRoute && !suppressRouteSync) {
    const route = "#/staff/" + (STAFF_TAB_ROUTE_MAP[tab] || "overview");
    if (window.location.hash !== route) history.pushState({ cnmiRoute:route }, "", route);
  }
  if (tab === "overview") loadStaffDashboard();
  if (tab === "donorImport") loadDonorDataFreshness();
  if (tab === "importLogs") loadImportLogHistory(1);
  if (tab === "notifications") loadStaffNotifications();
  if (tab === "questions") { loadStaffQuestions(); loadPushSubscriptionState(); }
  if (tab === "knowledge") loadStaffKnowledgeBase();
  if (tab === "slots") loadPlateletMonthAdmin();
  if (tab === "bookings") loadStaffBookings();
  if (tab === "groupSlots") loadGroupBookingMonthAdmin();
  if (tab === "groups") loadStaffGroupRequests();
  if (tab === "mobileUnits") loadStaffMobileUnitRequests();
  if (tab === "roomCalendar") loadRoomCalendarAdmin();
  if (tab === "screeningQuestions") { showScreeningQuestionPane("list"); loadScreeningQuestionsAdmin(); }
  if (tab === "screeningQuestionHistory") loadScreeningQuestionHistory(1);
  if (tab === "manual") renderStaffManual();
  if (tab === "admin") adminLoadStaffAccessList();
}

function showScreeningQuestionPane(pane) {
  const target = pane === "form" ? "form" : "list";
  const listPanel = $("screeningQuestionListPanel");
  const formPanel = $("screeningQuestionFormPanel");
  const listBtn = $("screeningPaneListBtn");
  const formBtn = $("screeningPaneFormBtn");
  if (listPanel) listPanel.classList.toggle("active", target === "list");
  if (formPanel) formPanel.classList.toggle("active", target === "form");
  if (listBtn) listBtn.classList.toggle("active", target === "list");
  if (formBtn) formBtn.classList.toggle("active", target === "form");
  if (target === "list") {
    const page = $("staffTab_screeningQuestions");
    if (page) page.scrollIntoView({ behavior:"smooth", block:"start" });
  }
}

function startNewScreeningQuestion() {
  resetScreeningQuestionForm();
  showScreeningQuestionPane("form");
  const text = $("screeningQuestionText");
  if (text) setTimeout(function(){ text.focus(); }, 120);
}

function resetScreeningQuestionForm() {
  if ($("screeningQuestionId")) $("screeningQuestionId").value = "";
  if ($("screeningQuestionText")) $("screeningQuestionText").value = "";
  if ($("screeningQuestionPass")) $("screeningQuestionPass").value = "yes";
  if ($("screeningQuestionGender")) $("screeningQuestionGender").value = "";
  if ($("screeningQuestionOrder")) {
    const maxOrder = currentScreeningAdminRows.reduce(function(max, row){ return Math.max(max, Number(row.sort_order || 0)); }, 0);
    $("screeningQuestionOrder").value = maxOrder + 10;
  }
  if ($("screeningQuestionActive")) $("screeningQuestionActive").value = "true";
  if ($("screeningQuestionFail")) $("screeningQuestionFail").value = "";
  if ($("screeningQuestionFormTitle")) $("screeningQuestionFormTitle").innerText = "เพิ่มคำถามใหม่";
  if ($("screeningPaneFormBtn")) $("screeningPaneFormBtn").innerHTML = '<i class="bi bi-plus-circle"></i><span>เพิ่มคำถาม</span>';
  if ($("screeningQuestionSaveBtn")) $("screeningQuestionSaveBtn").innerHTML = '<i class="bi bi-plus-circle"></i> เพิ่มคำถาม';
  if ($("screeningQuestionFormResult")) $("screeningQuestionFormResult").style.display = "none";
}

function screeningGenderLabel(value) {
  if (value === "ชาย") return "เฉพาะผู้ชาย";
  if (value === "หญิง") return "เฉพาะผู้หญิง";
  return "ทุกคน";
}

function screeningAnswerLabel(value) { return value === "no" ? "ไม่ใช่" : "ใช่"; }

const STAFF_MANUAL_SECTIONS = [
  {
    id: "manual-start",
    badge: "เริ่มต้น",
    title: "เริ่มใช้งานจากตรงไหน",
    intro: "ถ้าเพิ่งเริ่มใช้ ให้จำง่าย ๆ ว่า ผู้บริจาคใช้หน้าแรกเพื่อเช็กข้อมูลและจองคิว ส่วนเจ้าหน้าที่เข้าหลังบ้านเพื่อดูคิว จัดตาราง และตอบคำขอ",
    images: [
      { src:"help-images/home.png", caption:"หน้าแรกของผู้บริจาค: ใช้เป็นจุดเริ่มต้นของทุกอย่าง" },
      { src:"help-images/donate-choice.png", caption:"หน้าเลือกประเภทการบริจาค: เกล็ดเลือดต้องจองคิวล่วงหน้า ส่วนเลือดแดงเดินเข้ามาได้" },
      { src:"help-images/check-eligibility.png", caption:"หน้าเช็กว่าวันนี้บริจาคได้ไหม: ใช้ตรวจสิทธิ์เบื้องต้นจาก Donor ID / วันเกิด / เบอร์โทร" }
    ],
    steps: [
      "ถ้าผู้บริจาคถามว่าเริ่มจากตรงไหน ให้แนะนำจากหน้าแรก แล้วเลือกเมนูตามสิ่งที่ต้องการทำ",
      "งานเกล็ดเลือด ให้ผู้บริจาคกด ‘บริจาคเกล็ดเลือด’ แล้วทำแบบคัดกรองก่อนเลือกวันและเวลา",
      "งานเช็กประวัติ ให้ผู้บริจาคกด ‘เช็กว่าบริจาคได้หรือยัง’ แล้วกรอกข้อมูลยืนยันตัวตน 3 รายการ",
      "ถ้าเป็นงานเจ้าหน้าที่ ให้เข้าปุ่ม ‘สำหรับเจ้าหน้าที่’ เพื่อจัดการข้อมูลด้านในระบบ"
    ],
    noteTitle: "เวลาช่วยผู้บริจาค",
    tips: [
      "ข้อความที่ผู้บริจาคเห็น ขอให้เขียนสั้น ๆ แบบที่เราใช้คุยกันจริง เช่น ‘กรุณาติดต่อเจ้าหน้าที่ก่อนจองคิว’",
      "ถ้าผู้บริจาคจำ Donor ID ไม่ได้ ให้กด ‘จำ Donor ID ไม่ได้’ แล้วค้นหาต่อได้เลย ไม่ต้องเริ่มกรอกใหม่"
    ]
  },
  {
    id: "manual-platelet-calendar",
    badge: "คิวเกล็ดเลือด",
    title: "ดูตารางเกล็ดเลือดและเช็กรายชื่อผู้จอง",
    intro: "หน้านี้ใช้เวลาต้องดูว่าแต่ละวันเปิดรับรอบไหนบ้าง มีคนจองไปแล้วกี่คน และวันนี้ต้องโทรหาหรือดูแลใครบ้าง",
    images: [
      { src:"help-images/platelet-calendar.png", caption:"ตารางเกล็ดเลือด: สีเขียวคือวันที่เปิดรับ รอบเช้า 09:00 และบ่าย 13:00" },
      { src:"help-images/platelet-popup.png", caption:"เมื่อกดที่รอบ ระบบจะแสดงว่ามีกี่คน พร้อมปุ่มลัดไปดูรายการของวันนั้น" },
      { src:"help-images/platelet-bookings-before-delete.png", caption:"หน้ารายการจอง: ใช้ดูชื่อ เบอร์โทร สถานะ และกดจัดการคิว" },
      { src:"help-images/platelet-bookings-history.png", caption:"หลังลบคิว รายการจะไปอยู่ในประวัติการจัดการคิวของวันนั้นทันที" }
    ],
    steps: [
      "ไปที่เมนู ‘ตารางเกล็ดเลือด’ เพื่อดูภาพรวมทั้งเดือนก่อน ว่าวันไหนเปิดหรือปิดรอบ",
      "ถ้าต้องการดูรายชื่อคนในรอบ ให้กดที่รอบนั้น แล้วเลือก ‘ดูรายการของวันนี้’",
      "ถ้าต้องติดต่อผู้บริจาค ให้เข้าเมนู ‘คิวเกล็ดเลือด’ แล้วเลือกวันที่เพื่อดูเบอร์โทร อีเมล และสถานะการจอง",
      "ถ้าจำเป็นต้องลบคิว เจ้าหน้าที่ทุกคนลบได้ แต่ระบบจะเก็บประวัติไว้ด้านล่างอัตโนมัติ"
    ],
    noteTitle: "ก่อนกดจัดการคิว",
    tips: [
      "ถ้าวันนั้นปิดรับแต่มีคนจองอยู่แล้ว รายชื่อจะยังอยู่ ให้ติดต่อผู้บริจาคก่อน ไม่ต้องลบคิวทิ้งทันที",
      "ก่อนลบคิว ให้เช็กชื่อ วันที่ เวลา และเลขนัดอีกครั้ง เพื่อกันลบผิดคน"
    ]
  },
  {
    id: "manual-room-calendar",
    badge: "ปฏิทินห้อง",
    title: "ตั้งวันเปิด–ปิดห้องและทำประกาศในหน้าเดียว",
    intro: "หน้านี้สำคัญมาก เพราะเป็นต้นทางของปฏิทินที่ผู้บริจาคเห็น และยังใช้สร้างข้อความประกาศรายเดือนให้พร้อมโพสต์ต่อได้เลย",
    images: [
      { src:"help-images/room-calendar-form.png", caption:"ส่วนบนของหน้า: ใช้เลือกเดือน เตรียมเดือน และบันทึกกิจกรรมของแต่ละวัน" },
      { src:"help-images/room-calendar-grid.png", caption:"ปฏิทินห้องบริจาค: คลิกแต่ละวันเพื่อดูหรือแก้รายละเอียดได้" },
      { src:"help-images/room-announcement.png", caption:"ประกาศพร้อมใช้: ระบบสรุปข้อความให้ พร้อมคัดลอกหรือดาวน์โหลดภาพประกาศ" }
    ],
    steps: [
      "เริ่มจากเลือกเดือนที่ต้องการจัดการ แล้วกด ‘เตรียมเดือน’ ถ้ายังไม่เคยสร้างเดือนนั้น",
      "ถ้ามีวันหยุด วันออกหน่วย หรือวันเปิดรับไม่ปกติ ให้กรอกวันที่ ประเภท หัวข้อ เวลา สถานที่ และข้อความสั้นที่ผู้บริจาคควรเห็น",
      "กด ‘บันทึกวันนี้’ ทุกครั้งหลังกรอกข้อมูล เพื่อให้ข้อมูลขึ้นในปฏิทินด้านล่าง",
      "เมื่อเช็กครบแล้ว ค่อยกด ‘เผยแพร่’ เพื่อให้ผู้บริจาคเห็นข้อมูลชุดนั้นในหน้าเว็บ",
      "ถ้าจะทำโพสต์หรือส่งข้อความต่อ ให้เลื่อนลงมาที่ ‘ประกาศพร้อมใช้’ แล้วกดคัดลอกหรือดาวน์โหลดภาพ"
    ],
    noteTitle: "เวลาทำปฏิทิน",
    tips: [
      "วันปกติไม่ต้องกรอกซ้ำ ระบบใส่เวลาเปิดรับมาตรฐานให้อยู่แล้ว",
      "ถ้าวันไหนเวลาเปลี่ยน ค่อยกรอกเวลาเฉพาะวันนั้น แล้วอ่านทวนก่อนกดเผยแพร่"
    ]
  },
  {
    id: "manual-screening",
    badge: "คำถามคัดกรอง",
    title: "เพิ่มคำถามคัดกรองแบบที่น้องอ่านแล้วทำตามได้",
    intro: "คำถามชุดนี้จะไปแสดงกับผู้บริจาคก่อนจองคิวเกล็ดเลือด ดังนั้นควรเขียนให้สั้น ชัด และบอกทางต่อให้ผู้บริจาคเข้าใจถ้าคำตอบไม่ผ่าน",
    images: [
      { src:"help-images/screening-form.png", caption:"แบบฟอร์มเพิ่มคำถาม: ระบุคำถาม คำตอบที่ถือว่าผ่าน ลำดับ และข้อความเมื่อไม่ผ่าน" },
      { src:"help-images/screening-list.png", caption:"รายการคำถามที่ใช้อยู่: ใช้แก้ไขหรือปิดใช้โดยไม่ลบประวัติ" },
      { src:"help-images/screening-history.png", caption:"หน้าประวัติคำถาม: แยกไว้อีกหน้าเพื่อดูว่าใครแก้อะไร เมื่อไร" }
    ],
    steps: [
      "พิมพ์คำถามให้ตรงประเด็น เช่น ถามเรื่องพักผ่อน อาหาร อาการป่วย หรือข้อห้ามชั่วคราว",
      "กำหนดให้ชัดว่า คำตอบแบบไหนถึงถือว่า ‘ผ่าน’ เช่น บางข้อผ่านเมื่อกด ‘ใช่’ แต่บางข้อผ่านเมื่อกด ‘ไม่ใช่’",
      "ใส่ข้อความเมื่อไม่ผ่านให้เป็นภาษาคน เช่น ‘กรุณาติดต่อเจ้าหน้าที่ก่อนจองคิว’ ไม่ต้องใช้ประโยคแข็งหรือยาวเกินไป",
      "ถ้ายังไม่พร้อมใช้งานจริง สามารถตั้งสถานะเป็น ‘ปิดใช้’ ไว้ก่อนได้",
      "ถ้าต้องตรวจสอบย้อนหลัง ให้ไปที่เมนู ‘ประวัติคำถาม’ ระบบจะแสดงรายการล่าสุดของวันนี้ให้ก่อน"
    ],
    noteTitle: "เขียนคำถามให้อ่านง่าย",
    tips: [
      "หนึ่งคำถามควรถามเรื่องเดียว ถ้าถามหลายเรื่องรวมกัน ผู้บริจาคจะไม่แน่ใจว่าควรตอบอะไร",
      "ก่อนแก้คำถามเดิม ให้ดูรายการที่ใช้อยู่ก่อน แล้วเช็กลำดับหลังบันทึกอีกครั้ง"
    ]
  },
  {
    id: "manual-daily-check",
    badge: "เช็กก่อนจบงาน",
    title: "เช็กลิสต์สั้น ๆ ก่อนออกจากหน้า",
    intro: "ถ้าทำงานกับแอพแล้วอยากกันพลาด ลองเช็ก 5 เรื่องนี้ทุกครั้งก่อนปิดงาน",
    images: [],
    steps: [
      "ถ้ามีการปรับตารางหรือปิดวัน ให้เช็กว่ากดบันทึกแล้ว และถ้าต้องการให้ผู้บริจาคเห็น ต้องกดเผยแพร่ด้วย",
      "ถ้าลบหรือเปลี่ยนสถานะคิวเกล็ดเลือด ให้ดูช่องประวัติการจัดการคิวว่าระบบบันทึกไว้แล้ว",
      "ถ้าแก้คำถามคัดกรอง ให้เปิดเมนู ‘ประวัติคำถาม’ เช็กอีกรอบว่ารายการขึ้นในวันที่ถูกต้อง",
      "ถ้าทำประกาศรายเดือน ให้ลองคัดลอกข้อความอ่านทวน 1 รอบก่อนโพสต์จริง",
      "ถ้ามีอะไรดูไม่ตรง ให้กด Refresh ของหน้านั้นก่อน แล้วค่อยเช็กอีกครั้ง"
    ],
    noteTitle: "ก่อนออกจากหน้า",
    tips: [
      "แก้ข้อมูลแล้ว ให้ดูผลที่แสดงจริงอีกครั้ง ไม่ดูแค่ข้อความว่าบันทึกสำเร็จ",
      "ถ้าใช้งานบนมือถือ ให้เลื่อนดูส่วนล่างของหน้าให้ครบ เพราะบางเมนูมีประวัติหรือปุ่มต่ออยู่ด้านล่าง"
    ]
  }
];

async function loadScreeningQuestionsAdmin() {
  const box = $("screeningQuestionsAdminList");
  if (!box) return;
  box.innerHTML = '<div class="staff-result">กำลังโหลดคำถาม...</div>';
  const { data, error } = await sb.from("screening_questions").select("*").order("sort_order", { ascending:true }).order("created_at", { ascending:true });
  if (error) {
    box.innerHTML = '<div class="staff-result error">โหลดคำถามไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>';
    return;
  }
  currentScreeningAdminRows = data || [];
  if (!currentScreeningAdminRows.length) {
    box.innerHTML = '<div class="staff-result">ยังไม่มีคำถาม กรุณากด “เพิ่มคำถาม” ด้านบน</div>';
    resetScreeningQuestionForm();
    return;
  }
  const rows = currentScreeningAdminRows.map(function(row, index){
    const active = row.is_active !== false;
    return '<div class="screening-admin-item ' + (active ? '' : 'is-inactive') + '">' +
      '<div class="screening-admin-order">' + escapeHtml(row.sort_order) + '</div>' +
      '<div class="screening-admin-main"><div class="screening-admin-title"><b>ข้อ ' + (index + 1) + '</b><span class="status-pill ' + (active ? 'success' : 'neutral') + '">' + (active ? 'เปิดใช้' : 'ปิดใช้') + '</span></div>' +
      '<div class="screening-admin-question">' + escapeHtml(row.question_text) + '</div>' +
      '<div class="screening-admin-meta"><span><i class="bi bi-check2-circle"></i> คำตอบที่ผ่าน: <b>' + screeningAnswerLabel(row.pass_answer) + '</b></span><span><i class="bi bi-person"></i> ' + screeningGenderLabel(row.gender) + '</span></div>' +
      '<div class="screening-admin-fail"><small>ข้อความเมื่อไม่ผ่าน</small><span>' + escapeHtml(row.fail_message) + '</span></div></div>' +
      '<div class="screening-admin-actions"><button type="button" class="btn btn-soft btn-sm" onclick="editScreeningQuestion(\'' + row.id + '\')"><i class="bi bi-pencil"></i> แก้ไข</button>' +
      '<button type="button" class="btn ' + (active ? 'btn-outline-danger' : 'btn-outline-success') + ' btn-sm" onclick="toggleScreeningQuestionActive(\'' + row.id + '\',' + (!active) + ')"><i class="bi ' + (active ? 'bi-pause-circle' : 'bi-play-circle') + '"></i> ' + (active ? 'ปิดใช้' : 'เปิดใช้') + '</button></div></div>';
  }).join("");
  box.innerHTML = rows;
  if (!$("screeningQuestionId").value) resetScreeningQuestionForm();
}

function editScreeningQuestion(id) {
  const row = currentScreeningAdminRows.find(function(item){ return item.id === id; });
  if (!row) return;
  $("screeningQuestionId").value = row.id;
  $("screeningQuestionText").value = row.question_text || "";
  $("screeningQuestionPass").value = row.pass_answer || "yes";
  $("screeningQuestionGender").value = row.gender || "";
  $("screeningQuestionOrder").value = row.sort_order || 10;
  $("screeningQuestionActive").value = String(row.is_active !== false);
  $("screeningQuestionFail").value = row.fail_message || "";
  $("screeningQuestionFormTitle").innerText = "แก้ไขคำถาม";
  if ($("screeningPaneFormBtn")) $("screeningPaneFormBtn").innerHTML = '<i class="bi bi-pencil-square"></i><span>แก้ไขคำถาม</span>';
  $("screeningQuestionSaveBtn").innerHTML = '<i class="bi bi-check2-circle"></i> บันทึกการแก้ไข';
  showScreeningQuestionPane("form");
  const form = $("screeningQuestionFormCard");
  if (form) form.scrollIntoView({ behavior:"smooth", block:"start" });
}

async function saveScreeningQuestion() {
  const id = String($("screeningQuestionId").value || "").trim();
  const question = String($("screeningQuestionText").value || "").trim();
  const failMessage = String($("screeningQuestionFail").value || "").trim();
  const passAnswer = $("screeningQuestionPass").value;
  const gender = $("screeningQuestionGender").value || null;
  const sortOrder = Number($("screeningQuestionOrder").value || 0);
  const isActive = $("screeningQuestionActive").value === "true";
  const box = $("screeningQuestionFormResult");
  const btn = $("screeningQuestionSaveBtn");
  if (!question) { setStaffResult(box, "กรุณากรอกคำถาม", false); return; }
  if (!failMessage) { setStaffResult(box, "กรุณากรอกข้อความแนะนำเมื่อคำตอบไม่ผ่าน", false); return; }
  if (!Number.isFinite(sortOrder) || sortOrder < 0) { setStaffResult(box, "ลำดับต้องเป็นตัวเลข 0 ขึ้นไป", false); return; }
  showBusy(btn, true, id ? "บันทึกการแก้ไข" : "เพิ่มคำถาม", "กำลังบันทึก...");
  const payload = {
    question_text: question,
    pass_answer: passAnswer,
    fail_message: failMessage,
    gender: gender,
    sort_order: Math.round(sortOrder),
    is_active: isActive
  };
  let result;
  if (id) result = await sb.from("screening_questions").update(payload).eq("id", id).select("id").single();
  else result = await sb.from("screening_questions").insert(payload).select("id").single();
  showBusy(btn, false, id ? "บันทึกการแก้ไข" : "เพิ่มคำถาม", "กำลังบันทึก...");
  if (result.error) { setStaffResult(box, "บันทึกไม่สำเร็จ\n" + result.error.message, false); return; }
  setStaffResult(box, id ? "บันทึกการแก้ไขแล้ว" : "เพิ่มคำถามแล้ว", true);
  screeningQuestionsLoadedAt = 0;
  await loadScreeningQuestionsAdmin();
  resetScreeningQuestionForm();
  showScreeningQuestionPane("list");
}

async function toggleScreeningQuestionActive(id, nextActive) {
  const row = currentScreeningAdminRows.find(function(item){ return item.id === id; });
  if (!row) return;
  showModal({
    title: nextActive ? "เปิดใช้คำถามนี้?" : "ปิดใช้คำถามนี้?",
    message: nextActive ? "คำถามนี้จะกลับไปแสดงในแบบคัดกรองเบื้องต้น" : "คำถามจะไม่แสดงกับผู้บริจาค แต่ข้อมูลและประวัติการแก้ไขยังคงอยู่",
    iconText: nextActive ? "✓" : "!",
    secondaryText:"ยกเลิก",
    primaryText: nextActive ? "เปิดใช้" : "ปิดใช้",
    onPrimary: async function(){
      const { error } = await sb.from("screening_questions").update({ is_active: !!nextActive }).eq("id", id);
      if (error) { showModal({ title:"ทำรายการไม่สำเร็จ", message:error.message, iconText:"!" }); return; }
      screeningQuestionsLoadedAt = 0;
      await loadScreeningQuestionsAdmin();
    }
  });
}

function renderStaffManual(force) {
  const box = $("staffManualContent");
  if (!box) return;
  if (force && !STAFF_MANUAL_SECTIONS.some(function(section){ return section.id === currentManualSectionId; })) currentManualSectionId = "manual-start";
  const active = STAFF_MANUAL_SECTIONS.find(function(section){ return section.id === currentManualSectionId; }) || STAFF_MANUAL_SECTIONS[0];

  const topics = STAFF_MANUAL_SECTIONS.map(function(section){
    const activeClass = section.id === active.id ? " active" : "";
    const iconMap = {
      "manual-start":"bi-house-heart",
      "manual-platelet-calendar":"bi-calendar2-check",
      "manual-room-calendar":"bi-calendar-event",
      "manual-screening":"bi-ui-checks-grid",
      "manual-daily-check":"bi-check2-square"
    };
    return '<button type="button" class="manual-topic-card' + activeClass + '" onclick="showManualSection(\'' + escapeHtml(section.id) + '\')">' +
      '<i class="bi ' + (iconMap[section.id] || 'bi-book') + '"></i><span><small>' + escapeHtml(section.badge) + '</small><b>' + escapeHtml(section.title) + '</b></span><i class="bi bi-chevron-right"></i></button>';
  }).join('');

  box.innerHTML = '<div class="card main-card staff-card p-4 mb-3 manual-hub-card">' +
    '<div class="manual-hub-head"><div><span class="manual-kicker">เลือกเรื่องที่ต้องการ</span><h4>ไม่ต้องไล่อ่านทั้งหน้า</h4><p>กดหัวข้อที่ต้องการ ระบบจะแสดงเฉพาะเรื่องนั้น พร้อมรูปและขั้นตอนที่เกี่ยวข้อง</p></div></div>' +
    '<div class="manual-topic-grid">' + topics + '</div></div>' +
    '<div id="manualSelectedSection">' + renderManualSection(active) + '</div>';
}

function showManualSection(sectionId) {
  if (!STAFF_MANUAL_SECTIONS.some(function(section){ return section.id === sectionId; })) return;
  currentManualSectionId = sectionId;
  renderStaffManual(true);
  const content = $("manualSelectedSection");
  if (content) content.scrollIntoView({ behavior:"smooth", block:"start" });
}

function renderManualSection(section) {
  const imagesHtml = (section.images || []).length
    ? '<div class="manual-image-grid">' + section.images.map(function(image){
        return '<figure class="manual-shot"><img src="' + escapeHtml(image.src) + '" alt="' + escapeHtml(image.caption || section.title) + '" loading="lazy"><figcaption>' + escapeHtml(image.caption || '') + '</figcaption></figure>';
      }).join('') + '</div>'
    : '';
  const stepsHtml = '<ol class="manual-step-list">' + (section.steps || []).map(function(step){ return '<li>' + escapeHtml(step) + '</li>'; }).join('') + '</ol>';
  const tipsHtml = (section.tips || []).length
    ? '<div class="manual-tip-box"><b>' + escapeHtml(section.noteTitle || "ถ้าเจอแบบนี้") + '</b><ul>' + section.tips.map(function(tip){ return '<li>' + escapeHtml(tip) + '</li>'; }).join('') + '</ul></div>'
    : '';
  return '<section id="' + escapeHtml(section.id) + '" class="card main-card staff-card p-4 mb-3 manual-section-card">' +
    '<div class="manual-section-head"><div><span>' + escapeHtml(section.badge) + '</span><h5>' + escapeHtml(section.title) + '</h5><p>' + escapeHtml(section.intro || '') + '</p></div></div>' +
    imagesHtml +
    '<div class="manual-content-grid"><div><h6>ทำตามนี้ทีละขั้น</h6>' + stepsHtml + '</div>' + tipsHtml + '</div>' +
  '</section>';
}

function screeningAuditActionLabel(action) {
  if (action === "insert") return "เพิ่มคำถาม";
  if (action === "update") return "แก้ไข / เปิด–ปิด";
  if (action === "delete") return "ลบคำถาม";
  return action || "รายการเปลี่ยนแปลง";
}

function screeningAuditFieldLabel(field) {
  const labels = {
    question_text: "คำถาม",
    pass_answer: "คำตอบที่ถือว่าผ่าน",
    fail_message: "ข้อความเมื่อไม่ผ่าน",
    gender: "แสดงกับ",
    sort_order: "ลำดับ",
    is_active: "สถานะ"
  };
  return labels[field] || field;
}

function screeningAuditValueLabel(field, value) {
  if (field === "pass_answer") return screeningAnswerLabel(value);
  if (field === "gender") return screeningGenderLabel(value);
  if (field === "is_active") return value === false ? "ปิดใช้" : "เปิดใช้";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getScreeningAuditQuestionText(row) {
  const snapshot = row.new_data || row.old_data || {};
  return snapshot.question_text || "คำถาม";
}

function buildScreeningAuditChangeRows(row) {
  const oldData = row.old_data || {};
  const newData = row.new_data || {};
  if (row.action === "insert") {
    return [
      '<div class="screening-history-change"><span>คำถาม</span><b>' + escapeHtml(getScreeningAuditQuestionText(row)) + '</b></div>',
      '<div class="screening-history-change"><span>คำตอบที่ผ่าน</span><b>' + escapeHtml(screeningAnswerLabel(newData.pass_answer)) + '</b></div>',
      '<div class="screening-history-change"><span>แสดงกับ</span><b>' + escapeHtml(screeningGenderLabel(newData.gender)) + '</b></div>'
    ];
  }
  if (row.action === "delete") {
    return [
      '<div class="screening-history-change"><span>คำถามที่ถูกลบ</span><b>' + escapeHtml(getScreeningAuditQuestionText(row)) + '</b></div>'
    ];
  }
  const fields = ["question_text","pass_answer","fail_message","gender","sort_order","is_active"];
  const changes = [];
  fields.forEach(function(field){
    const before = oldData[field];
    const after = newData[field];
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    changes.push('<div class="screening-history-change"><span>' + escapeHtml(screeningAuditFieldLabel(field)) + '</span><div><small>เดิม: ' + escapeHtml(screeningAuditValueLabel(field, before)) + '</small><b>ใหม่: ' + escapeHtml(screeningAuditValueLabel(field, after)) + '</b></div></div>');
  });
  if (!changes.length) changes.push('<div class="screening-history-change"><span>สรุป</span><b>มีการอัปเดตข้อมูลของคำถามนี้</b></div>');
  return changes;
}

function renderScreeningAuditCards(rows, options) {
  options = options || {};
  if (!rows || !rows.length) {
    return '<div class="log-empty"><i class="bi bi-inbox"></i><span>' + escapeHtml(options.emptyText || 'ยังไม่มีประวัติในวันที่เลือก') + '</span></div>';
  }
  return '<div class="friendly-log-list screening-history-list">' + rows.map(function(row){
    const action = screeningAuditActionLabel(row.action);
    const icon = row.action === 'delete' ? 'bi-trash3' : (row.action === 'insert' ? 'bi-plus-circle' : 'bi-pencil-square');
    const question = getScreeningAuditQuestionText(row);
    return '<article class="friendly-log-card screening-history-card">' +
      '<div class="friendly-log-top"><div><span class="friendly-log-type">' + escapeHtml(action) + '</span><b>' + escapeHtml(formatBangkokLogTime(row.created_at, false)) + '</b></div><i class="bi ' + icon + '"></i></div>' +
      '<div class="friendly-log-file"><i class="bi bi-chat-left-text"></i><span>' + escapeHtml(question) + '</span></div>' +
      '<div class="friendly-log-meta-line"><span>ผู้ดำเนินการ</span><b>' + escapeHtml(row.actor_name || 'เจ้าหน้าที่') + '</b></div>' +
      '<div class="screening-history-changes">' + buildScreeningAuditChangeRows(row).join('') + '</div>' +
    '</article>';
  }).join('') + '</div>';
}

async function fetchScreeningQuestionAuditRows() {
  const { data, error } = await sb.rpc("screening_question_audit_feed", { p_limit: 100 });
  if (error) throw error;
  screeningQuestionAuditCache = Array.isArray(data) ? data : [];
  return screeningQuestionAuditCache;
}

async function loadScreeningQuestionHistory(page) {
  const box = $("screeningQuestionHistoryResult");
  if (!box) return;
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const date = $("screeningHistoryDate")?.value || todayISO();
  const action = $("screeningHistoryAction")?.value || "";
  if ($("screeningHistoryDate") && !$("screeningHistoryDate").value) $("screeningHistoryDate").value = date;

  screeningQuestionHistoryPage = Math.max(1, Number(page || screeningQuestionHistoryPage || 1));
  box.className = "staff-result";
  box.innerHTML = "กำลังโหลดประวัติ...";

  try {
    const rows = await fetchScreeningQuestionAuditRows();
    const bounds = bangkokDayBoundsISO(date);
    const filtered = rows.filter(function(row){
      const created = String(row.created_at || "");
      if (created < bounds.start || created >= bounds.end) return false;
      if (action && row.action !== action) return false;
      return true;
    });

    const pageSize = 5;
    const total = filtered.length;
    screeningQuestionHistoryTotalPages = Math.max(1, Math.ceil(total / pageSize));
    if (screeningQuestionHistoryPage > screeningQuestionHistoryTotalPages && total > 0) {
      screeningQuestionHistoryPage = screeningQuestionHistoryTotalPages;
    }
    const start = (screeningQuestionHistoryPage - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    box.className = "staff-result friendly-log-box";
    box.innerHTML = '<div class="log-day-heading"><div><span>วันที่</span><b>' + escapeHtml(isoToThaiDate(date, true)) + '</b></div><span>' + escapeHtml(total) + ' รายการ</span></div>' +
      renderScreeningAuditCards(pageRows, { emptyText:'ไม่พบประวัติการแก้ไขในเงื่อนไขนี้' });

    const pager = $("screeningQuestionHistoryPager");
    const pageText = $("screeningQuestionHistoryPageText");
    if (pager) pager.style.display = total > pageSize ? "flex" : "none";
    if (pageText) pageText.innerText = screeningQuestionHistoryPage + " / " + screeningQuestionHistoryTotalPages;
    if (pager) {
      const buttons = pager.querySelectorAll('button');
      if (buttons[0]) buttons[0].disabled = screeningQuestionHistoryPage <= 1;
      if (buttons[1]) buttons[1].disabled = screeningQuestionHistoryPage >= screeningQuestionHistoryTotalPages;
    }
  } catch (err) {
    box.className = "staff-result fail";
    box.innerText = "โหลดประวัติไม่สำเร็จ\n" + (err.message || err);
  }
}

function changeScreeningQuestionHistoryPage(delta) {
  const next = Math.min(screeningQuestionHistoryTotalPages, Math.max(1, screeningQuestionHistoryPage + Number(delta || 0)));
  if (next !== screeningQuestionHistoryPage) loadScreeningQuestionHistory(next);
}

async function getExactCount(builder) {
  const { count, error } = await builder;
  if (error) throw error;
  return count || 0;
}

function bangkokDayBoundsISO(dateText) {
  const d = isoDateObj(dateText || todayISO()) || isoDateObj(todayISO());
  const y = d.getFullYear(), m = pad2(d.getMonth() + 1), day = pad2(d.getDate());
  const start = new Date(y + "-" + m + "-" + day + "T00:00:00+07:00");
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0, 0);
  const ny = next.getFullYear(), nm = pad2(next.getMonth() + 1), nd = pad2(next.getDate());
  const end = new Date(ny + "-" + nm + "-" + nd + "T00:00:00+07:00");
  return { start:start.toISOString(), end:end.toISOString() };
}

function importTypeLabel(type) {
  const key = String(type || "").trim();
  if (key === "donor_import") return "นำเข้าข้อมูลผู้บริจาค";
  if (key === "infectious_update") return "อัปเดตผลติดเชื้อ";
  return key ? "งานนำเข้าข้อมูล" : "ไม่ระบุประเภท";
}

function parseImportLogMessage(message) {
  const raw = String(message || "").trim();
  const result = { file:"", sheet:"", mode:"", dataThrough:"", by:"", other:"" };
  if (!raw) return result;
  raw.split(",").map(x => x.trim()).filter(Boolean).forEach(part => {
    const idx = part.indexOf("=");
    if (idx < 0) {
      result.other = result.other ? result.other + ", " + part : part;
      return;
    }
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (key === "file") result.file = value;
    else if (key === "sheet") result.sheet = value;
    else if (key === "mode") result.mode = value;
    else if (key === "data_through") result.dataThrough = value;
    else if (key === "by") result.by = value;
    else result.other = result.other ? result.other + ", " + part : part;
  });
  return result;
}

function formatBangkokLogTime(value, includeDate) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("th-TH", {
      timeZone:"Asia/Bangkok",
      day: includeDate ? "numeric" : undefined,
      month: includeDate ? "short" : undefined,
      year: includeDate ? "numeric" : undefined,
      hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
    }).format(new Date(value));
  } catch (err) {
    return "-";
  }
}


function currentStaffDisplayName() {
  return String(currentStaffProfile?.display_name || currentStaffProfile?.email || "เจ้าหน้าที่").trim();
}

function calendarDayCountInclusive(startIso, endIso) {
  const a = isoDateObj(startIso), b = isoDateObj(endIso);
  if (!a || !b || a > b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

function inferDataThroughFromFileName(fileName) {
  const name = String(fileName || "");
  const m = name.match(/(?:^|\D)(\d{8})(?:\D|$)/);
  if (!m) return "";
  const token = m[1];
  let y, mo, d;
  const first4 = Number(token.slice(0,4));
  const last4 = Number(token.slice(4,8));
  if (first4 >= 1900 && first4 <= 2700) {
    y = first4 > 2400 ? first4 - 543 : first4;
    mo = Number(token.slice(4,6));
    d = Number(token.slice(6,8));
  } else if (last4 >= 1900 && last4 <= 2700) {
    d = Number(token.slice(0,2));
    mo = Number(token.slice(2,4));
    y = last4 > 2400 ? last4 - 543 : last4;
  } else return "";
  if (!isValidCalendarDate_(y, mo, d)) return "";
  return y + "-" + pad2(mo) + "-" + pad2(d);
}

let latestDonorDataMeta = null;

function renderDonorFreshnessBanner(meta, errorText) {
  const targets = [$('donorDataFreshnessBanner'), $('donorImportFreshnessBanner')].filter(Boolean);
  const today = todayISO();
  targets.forEach(function(box) {
    box.classList.remove('current','stale','warning');
    const strong = box.querySelector('strong');
    const span = box.querySelector('.donor-freshness-copy span');
    const small = box.querySelector('.donor-freshness-copy small');
    if (errorText) {
      box.classList.add('warning');
      if (small) small.innerText = 'สถานะข้อมูลผู้บริจาค';
      if (strong) strong.innerText = 'ตรวจสอบวันที่ข้อมูลล่าสุดไม่สำเร็จ';
      if (span) span.innerText = errorText;
      return;
    }
    if (!meta || !meta.dataThrough) {
      box.classList.add('warning');
      if (small) small.innerText = 'สถานะข้อมูลผู้บริจาค';
      if (strong) strong.innerText = 'ยังไม่ได้ระบุว่า ข้อมูลผู้บริจาคล่าสุดถึงวันที่เท่าไร';
      if (span) span.innerText = 'ครั้งถัดไปที่นำเข้า ให้เลือก “ข้อมูลในไฟล์นี้อัปเดตล่าสุดถึงวันที่” ระบบจะจำให้เอง';
      return;
    }
    const latest = meta.dataThrough;
    const who = meta.by || 'ไม่ระบุชื่อผู้บันทึก';
    const when = formatBangkokLogTime(meta.created_at, true);
    if (small) small.innerText = meta.inferred ? 'สถานะจากประวัติเดิม' : 'ข้อมูลผู้บริจาคล่าสุด';
    if (strong) strong.innerText = (meta.inferred ? 'คาดว่าข้อมูลล่าสุดถึงวันที่ ' : 'อัปเดตถึงวันที่ ') + isoToThaiDate(latest, true);
    if (latest === today) {
      box.classList.add('current');
      if (span) span.innerText = (meta.inferred ? 'คาดจากชื่อไฟล์เดิม · กรุณายืนยันวันที่ในการนำเข้าครั้งถัดไป · ' : 'ข้อมูลเป็นปัจจุบันถึงวันนี้ · ') + 'อัปโหลดโดย ' + who + ' · ' + when;
    } else if (latest < today) {
      box.classList.add('stale');
      const start = addDaysISO(latest, 1);
      const count = calendarDayCountInclusive(start, today);
      if (span) span.innerText = (meta.inferred ? 'คาดจากชื่อไฟล์เดิม · ' : '') + 'ต้องอัปเดตต่อวันที่ ' + isoToThaiDate(start, true) + ' – ' + isoToThaiDate(today, true) + ' (' + count + ' วัน) · ครั้งล่าสุดโดย ' + who + ' · ' + when;
    } else {
      box.classList.add('warning');
      if (span) span.innerText = 'วันที่ข้อมูลล่าสุดอยู่หลังวันนี้ กรุณาตรวจสอบ · บันทึกโดย ' + who + ' · ' + when;
    }
  });
  updateDonorImportDateHint();
}

async function loadDonorDataFreshness() {
  const input = $('donorDataThroughDate');
  if (input) input.max = todayISO();
  try {
    const { data, error } = await sb.from('import_logs')
      .select('message,created_at,created_by')
      .eq('import_type','donor_import')
      .order('created_at',{ ascending:false })
      .limit(200);
    if (error) throw error;
    let best = null;
    (Array.isArray(data) ? data : []).forEach(function(row) {
      const info = parseImportLogMessage(row.message);
      const explicit = /^\d{4}-\d{2}-\d{2}$/.test(info.dataThrough || '') ? info.dataThrough : '';
      const inferred = explicit ? '' : inferDataThroughFromFileName(info.file);
      const dateValue = explicit || inferred;
      if (!dateValue) return;
      if (!best || dateValue > best.dataThrough || (dateValue === best.dataThrough && explicit && best.inferred) || (dateValue === best.dataThrough && String(row.created_at || '') > String(best.created_at || ''))) {
        best = { dataThrough:dateValue, by:info.by || (explicit ? '' : 'ไม่พบชื่อในประวัติเวอร์ชันเดิม'), created_at:row.created_at || '', created_by:row.created_by || null, inferred:!explicit, file:info.file || '' };
      }
    });
    latestDonorDataMeta = best;
    renderDonorFreshnessBanner(best, '');
    return best;
  } catch (err) {
    latestDonorDataMeta = null;
    renderDonorFreshnessBanner(null, err.message || String(err));
    return null;
  }
}

function updateDonorImportDateHint() {
  const input = $('donorDataThroughDate');
  const hint = $('donorImportDateHint');
  const btn = $('btnImportDonor');
  if (!input || !hint) return;
  const value = input.value || '';
  if (btn && pendingDonorImport) btn.disabled = !value;
  if (!value) {
    hint.className = 'data-through-hint mt-2';
    hint.innerText = 'กรุณาระบุทุกครั้ง เพื่อให้ระบบจำแทนเจ้าหน้าที่ว่าครั้งหน้าต้องอัปเดตต่อจากวันไหน';
    return;
  }
  if (!latestDonorDataMeta?.dataThrough) {
    hint.className = 'data-through-hint mt-2 ok';
    hint.innerText = 'ระบบจะบันทึกว่า ข้อมูลผู้บริจาคครอบคลุมถึงวันที่ ' + isoToThaiDate(value, true);
    return;
  }
  const latest = latestDonorDataMeta.dataThrough;
  if (value < latest) {
    hint.className = 'data-through-hint mt-2 warn';
    hint.innerText = 'วันที่นี้เก่ากว่าสถานะล่าสุดในระบบ (' + isoToThaiDate(latest, true) + ') สามารถนำเข้าเพื่อเติมข้อมูลย้อนหลังได้ แต่ระบบจะไม่ลดวันที่ข้อมูลล่าสุด';
  } else if (value === latest) {
    hint.className = 'data-through-hint mt-2';
    hint.innerText = 'วันที่เดียวกับข้อมูลล่าสุดในระบบ ใช้ได้หากกำลังนำเข้าไฟล์แก้ไข/เติมข้อมูลของวันเดิม';
  } else {
    const start = addDaysISO(latest, 1);
    hint.className = 'data-through-hint mt-2 ok';
    hint.innerText = 'กรุณายืนยันว่าไฟล์ชุดนี้ครอบคลุมข้อมูลตั้งแต่ ' + isoToThaiDate(start, true) + ' ถึง ' + isoToThaiDate(value, true) + ' ครบแล้ว';
  }
}

function renderImportLogCards(rows, options) {
  options = options || {};
  if (!rows || rows.length === 0) {
    return '<div class="log-empty"><i class="bi bi-inbox"></i><span>' + escapeHtml(options.emptyText || "ยังไม่มีกิจกรรมนำเข้าในวันที่เลือก") + '</span></div>';
  }
  return '<div class="friendly-log-list">' + rows.map(function(r) {
    const info = parseImportLogMessage(r.message);
    const fileLine = info.file ? '<div class="friendly-log-file"><i class="bi bi-file-earmark-spreadsheet"></i><span>' + escapeHtml(info.file) + '</span></div>' : '';
    const inferredLogDate = (!info.dataThrough && r.import_type === "donor_import") ? inferDataThroughFromFileName(info.file) : "";
    const whoLine = '<div class="friendly-log-meta-line important"><span>อัปโหลดโดย</span><b>' + escapeHtml(info.by || "เวอร์ชันเดิมไม่ได้บันทึกชื่อ") + '</b></div>';
    const dataDateLine = (info.dataThrough || inferredLogDate) ? '<div class="friendly-log-meta-line important"><span>' + (info.dataThrough ? 'ข้อมูลล่าสุดถึง' : 'คาดจากชื่อไฟล์ว่า ถึง') + '</span><b>' + escapeHtml(isoToThaiDate(info.dataThrough || inferredLogDate, true)) + '</b></div>' : '';
    const dateTimeLine = '<div class="friendly-log-meta-line"><span>วัน-เวลาที่อัปโหลด</span><b>' + escapeHtml(formatBangkokLogTime(r.created_at, true)) + '</b></div>';
    const sheetLine = (!options.compact && info.sheet) ? '<div class="friendly-log-meta-line"><span>ชีต</span><b>' + escapeHtml(info.sheet) + '</b></div>' : '';
    const systemBits = [];
    if (info.mode) systemBits.push("mode=" + info.mode);
    if (info.other) systemBits.push(info.other);
    const systemDetails = (!options.compact && systemBits.length)
      ? '<details class="log-system-details"><summary>รายละเอียดทางระบบ</summary><div>' + escapeHtml(systemBits.join(", ")) + '</div></details>'
      : '';
    return '<article class="friendly-log-card">' +
      '<div class="friendly-log-top"><div><span class="friendly-log-type">' + escapeHtml(importTypeLabel(r.import_type)) + '</span><b>' + escapeHtml(formatBangkokLogTime(r.created_at, !!options.includeDate)) + '</b></div>' +
      '<i class="bi ' + (r.import_type === "infectious_update" ? "bi-shield-check" : "bi-database-check") + '"></i></div>' +
      '<div class="friendly-log-stats"><span><small>สำเร็จ</small><b>' + escapeHtml(r.imported_count ?? 0) + '</b></span><span><small>ข้าม</small><b>' + escapeHtml(r.skipped_count ?? 0) + '</b></span></div>' +
      whoLine + dataDateLine + dateTimeLine + fileLine + sheetLine + systemDetails +
      '</article>';
  }).join('') + '</div>';
}

function renderDashboardImportLogs() {
  const logBox = $("dashboardImportLogs");
  const pager = $("dashboardLogPager");
  const pageText = $("dashboardLogPageText");
  if (!logBox) return;
  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(dashboardImportRows.length / pageSize));
  dashboardImportPage = Math.min(Math.max(1, dashboardImportPage), totalPages);
  const start = (dashboardImportPage - 1) * pageSize;
  const rows = dashboardImportRows.slice(start, start + pageSize);
  logBox.className = "staff-result compact friendly-log-box";
  logBox.innerHTML = renderImportLogCards(rows, { compact:true, emptyText:"วันนี้ยังไม่มีการนำเข้าข้อมูล" });
  if (pager) pager.style.display = dashboardImportRows.length > pageSize ? "flex" : "none";
  if (pageText) pageText.innerText = dashboardImportPage + " / " + totalPages;
  if (pager) {
    const buttons = pager.querySelectorAll("button");
    if (buttons[0]) buttons[0].disabled = dashboardImportPage <= 1;
    if (buttons[1]) buttons[1].disabled = dashboardImportPage >= totalPages;
  }
}

function changeDashboardLogPage(delta) {
  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(dashboardImportRows.length / pageSize));
  dashboardImportPage = Math.min(totalPages, Math.max(1, dashboardImportPage + Number(delta || 0)));
  renderDashboardImportLogs();
}

async function loadStaffDashboard() {
  if (!currentStaffProfile) return;
  const box = $("dashboardResult");
  const logBox = $("dashboardImportLogs");
  const today = todayISO();

  if (box) box.innerText = "กำลังโหลดภาพรวม...";
  if (logBox) logBox.innerText = "กำลังโหลดประวัติ...";
  loadDonorDataFreshness();

  try {
    const bookingsToday = await getExactCount(
      sb.from("bookings").select("id", { count:"exact", head:true }).eq("booking_date", today).eq("donation_type", "Platelet").neq("status", "ยกเลิก")
    );
    const tomorrow = addDaysISO(today, 1);
    const bookingsTomorrow = await getExactCount(
      sb.from("bookings").select("id", { count:"exact", head:true }).eq("booking_date", tomorrow).eq("donation_type", "Platelet").neq("status", "ยกเลิก")
    );
    const newRequests = await getExactCount(
      sb.from("staff_notifications").select("id", { count:"exact", head:true }).eq("is_read", false)
    );
    const slotsToday = await getExactCount(
      sb.from("booking_slots").select("id", { count:"exact", head:true }).eq("booking_date", today)
    );
    const infectiousCount = await getExactCount(
      sb.from("donor_donations").select("id", { count:"exact", head:true }).eq("infectious_flag", true)
    );
    const donationCount = await getExactCount(
      sb.from("donor_donations").select("id", { count:"exact", head:true })
    );

    if ($("dashBookingsToday")) $("dashBookingsToday").innerText = bookingsToday;
    if ($("dashBookingsTomorrow")) $("dashBookingsTomorrow").innerText = bookingsTomorrow;
    if ($("dashNewRequests")) $("dashNewRequests").innerText = newRequests;
    updateStaffNotificationBadge(newRequests);
    updateStaffQuestionBadge();
    if ($("dashSlotsToday")) $("dashSlotsToday").innerText = slotsToday;
    if ($("dashInfectious")) $("dashInfectious").innerText = infectiousCount;
    if ($("dashDonations")) $("dashDonations").innerText = donationCount;

    if (box) {
      box.className = "staff-result ok compact";
      box.innerText =
        "วันที่ " + isoToDDMMYYYY(today) + "\n" +
        "คิวเกล็ดเลือดวันนี้: " + bookingsToday + " รายการ\n" +
        "คิวเกล็ดเลือดพรุ่งนี้: " + bookingsTomorrow + " รายการ\n" +
        "รายการใหม่ที่ยังไม่ได้อ่าน: " + newRequests + " รายการ\n" +
        "รอบเกล็ดเลือดวันนี้: " + slotsToday + " ช่วงเวลา\n" +
        "ต้องติดต่อเจ้าหน้าที่: " + infectiousCount + " รายการ\n" +
        "บริจาคทั้งหมด: " + donationCount + " รายการ";
    }

    const bounds = bangkokDayBoundsISO(today);
    const { data: logs, error: logError } = await sb.from("import_logs")
      .select("*")
      .gte("created_at", bounds.start)
      .lt("created_at", bounds.end)
      .order("created_at", { ascending:false })
      .limit(60);

    if (logError) throw logError;
    dashboardImportRows = Array.isArray(logs) ? logs : [];
    dashboardImportPage = 1;
    renderDashboardImportLogs();
  } catch (err) {
    if (box) {
      box.className = "staff-result fail";
      box.innerText = "โหลดภาพรวมไม่สำเร็จ\n" + (err.message || err);
    }
    if (logBox) {
      logBox.className = "staff-result fail";
      logBox.innerText = "โหลดประวัติไม่สำเร็จ";
    }
  }
}

async function loadImportLogHistory(page) {
  const box = $("importLogHistoryResult");
  if (!box) return;
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const date = $("importLogDate")?.value || todayISO();
  const type = $("importLogType")?.value || "";
  if ($("importLogDate") && !$("importLogDate").value) $("importLogDate").value = date;

  const pageSize = 5;
  importLogHistoryPage = Math.max(1, Number(page || importLogHistoryPage || 1));
  const bounds = bangkokDayBoundsISO(date);

  box.className = "staff-result";
  box.innerHTML = "กำลังโหลดประวัติ...";
  let query = sb.from("import_logs")
    .select("*", { count:"exact" })
    .gte("created_at", bounds.start)
    .lt("created_at", bounds.end)
    .order("created_at", { ascending:false });

  if (type) query = query.eq("import_type", type);
  const start = (importLogHistoryPage - 1) * pageSize;
  const end = start + pageSize - 1;
  const { data, count, error } = await query.range(start, end);

  if (error) {
    box.className = "staff-result fail";
    box.innerText = "โหลดประวัติไม่สำเร็จ\n" + error.message;
    return;
  }

  const total = Number(count || 0);
  importLogHistoryTotalPages = Math.max(1, Math.ceil(total / pageSize));
  if (importLogHistoryPage > importLogHistoryTotalPages && total > 0) {
    importLogHistoryPage = importLogHistoryTotalPages;
    return loadImportLogHistory(importLogHistoryPage);
  }

  box.className = "staff-result friendly-log-box";
  box.innerHTML = '<div class="log-day-heading"><div><span>วันที่</span><b>' + escapeHtml(isoToThaiDate(date, true)) + '</b></div><span>' + escapeHtml(total) + ' รายการ</span></div>' +
    renderImportLogCards(Array.isArray(data) ? data : [], { includeDate:false, emptyText:"ไม่พบ Log ตามตัวกรองนี้" });

  const pager = $("importLogHistoryPager");
  const pageText = $("importLogHistoryPageText");
  if (pager) pager.style.display = total > pageSize ? "flex" : "none";
  if (pageText) pageText.innerText = importLogHistoryPage + " / " + importLogHistoryTotalPages;
  if (pager) {
    const buttons = pager.querySelectorAll("button");
    if (buttons[0]) buttons[0].disabled = importLogHistoryPage <= 1;
    if (buttons[1]) buttons[1].disabled = importLogHistoryPage >= importLogHistoryTotalPages;
  }
}

function changeImportLogHistoryPage(delta) {
  const next = Math.min(importLogHistoryTotalPages, Math.max(1, importLogHistoryPage + Number(delta || 0)));
  if (next !== importLogHistoryPage) loadImportLogHistory(next);
}

async function readWorkbookFromFile(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(new Uint8Array(buffer), { type:"array", cellDates:false, cellNF:true, cellText:true });
}

function getSheet(workbook, preferredNames) {
  for (const name of preferredNames) {
    const found = workbook.SheetNames.find(s => s.trim().toLowerCase() === name.toLowerCase());
    if (found) return { name: found, sheet: workbook.Sheets[found] };
  }
  const first = workbook.SheetNames[0];
  return { name:first, sheet:workbook.Sheets[first] };
}

function sheetToCellRows(sheet) {
  if (!sheet || !sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      row.push(sheet[addr] || null);
    }
    rows.push(row);
  }
  return rows;
}

function cellRawText(cell, keepNumberAsInteger) {
  if (!cell) return "";
  if (keepNumberAsInteger && typeof cell.v === "number") return String(Math.trunc(cell.v));
  if (keepNumberAsInteger && typeof cell.w === "string" && /e\+\d+/i.test(cell.w) && typeof cell.v === "number") return String(Math.trunc(cell.v));
  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== "") return String(cell.w).trim();
  if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
  return "";
}

function normalizeDonorId(value) {
  let text = String(value || "").trim().replace(/,/g, "").replace(/^'/, "");
  if (/^\d+(\.\d+)?e\+\d+$/i.test(text)) text = String(Math.trunc(Number(text)));
  return text.replace(/\s/g, "").toUpperCase();
}

function normalizeIdDocument(value) {
  let text = String(value || "").trim().replace(/,/g, "").replace(/^'/, "");
  if (/^\d+(\.\d+)?e\+\d+$/i.test(text)) text = String(Math.trunc(Number(text)));
  return text.replace(/\s/g, "").toUpperCase();
}

function normalizePhone(value) { return onlyDigits(value); }
function phoneLast4(phone) { const d = onlyDigits(phone); return d ? d.slice(-4) : ""; }
function convertBloodGroup(bg) {
  const key = String(bg || "").trim().toUpperCase().replace(/\s/g, "");
  const map = { "O+":"O,RhD+", "A+":"A,RhD+", "B+":"B,RhD+", "AB+":"AB,RhD+", "O-":"O,RhD-", "A-":"A,RhD-", "B-":"B,RhD-", "AB-":"AB,RhD-" };
  return map[key] || String(bg || "").trim();
}
function convertSex(s) {
  const key = String(s || "").trim().toUpperCase();
  if (key === "F") return "หญิง";
  if (key === "M") return "ชาย";
  return String(s || "").trim();
}

function fixYear(rawYear, isDob) {
  const raw = (rawYear === null || rawYear === undefined) ? "" : String(rawYear).trim();
  if (raw === "") return "";
  const y = parseInt(raw, 10);
  if (Number.isNaN(y)) return "";
  if (y > 2400) return y - 543;
  if (/^\d{1,2}$/.test(raw)) {
    if (isDob) {
      const yy = y;
      const currentYY = Number(new Date().getFullYear().toString().slice(-2));
      return yy <= currentYY ? 2000 + yy : 1900 + yy;
    }
    return 2000 + y;
  }
  return y;
}

function parseExcelSerial(cell, isDob) {
  if (!cell || typeof cell.v !== "number") return null;
  const parsed = XLSX.SSF.parse_date_code(cell.v);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
  const yyyy = fixYear(parsed.y, isDob);
  return {
    iso: `${yyyy}-${pad2(parsed.m)}-${pad2(parsed.d)}`,
    time: `${pad2(parsed.H || 0)}:${pad2(parsed.M || 0)}`
  };
}

function parseDateText(text, order, isDob) {
  let s = String(text || "").trim();
  if (!s) return { iso:"", time:"" };
  s = s.replace(/-/g, "/");
  const partsAll = s.split(/\s+/);
  const datePart = partsAll[0];
  let timePart = partsAll[1] || "";
  const p = datePart.split("/");
  if (p.length !== 3) return { iso:"", time:"" };

  let a = parseInt(p[0], 10);
  let b = parseInt(p[1], 10);
  const y = fixYear(p[2], isDob);
  if (!a || !b || !y) return { iso:"", time:"" };

  let d, m;
  if (order === "DMY") { d = a; m = b; }
  else if (order === "MDY") { m = a; d = b; }
  else {
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (b > 12 && a <= 12) { m = a; d = b; }
    else { d = a; m = b; }
  }

  if (timePart) {
    const tm = timePart.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (tm) {
      let hh = parseInt(tm[1], 10);
      const mm = tm[2];
      const ap = tm[3] ? tm[3].toUpperCase() : "";
      if (ap === "PM" && hh < 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
      timePart = `${pad2(hh)}:${mm}`;
    }
  }

  return { iso:`${y}-${pad2(m)}-${pad2(d)}`, time: timePart || "" };
}

function parseDateCell(cell, order, isDob) {
  if (!cell) return { iso:"", time:"" };
  if (typeof cell.v === "number") {
    const parsed = parseExcelSerial(cell, isDob);
    if (parsed) return parsed;
  }
  const text = cellRawText(cell, false);
  return parseDateText(text, order, isDob);
}

function parseNumberCell(cell) {
  if (!cell) return null;
  if (typeof cell.v === "number") return Math.trunc(cell.v);
  const text = cellRawText(cell, false).replace(/,/g, "").trim();
  const n = parseFloat(text);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_./()-]/g, "");
}

function findHeaderRow(rows, expectedHeaders) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const values = rows[r].map(cell => normalizeHeader(cellRawText(cell, false)));
    for (const h of expectedHeaders) {
      if (values.includes(normalizeHeader(h))) return r;
    }
  }
  return -1;
}

function buildHeaderMap(rows, headerRowIndex) {
  const map = {};
  const headerRow = rows[headerRowIndex] || [];
  headerRow.forEach((cell, idx) => { map[normalizeHeader(cellRawText(cell, false))] = idx; });
  return map;
}

function getCellByHeader(row, map, names) {
  for (const n of names) {
    const idx = map[normalizeHeader(n)];
    if (idx !== undefined) return row[idx] || null;
  }
  return null;
}

function parseDonorWorkbook(workbook) {
  const donorSheet = workbook.SheetNames.find(n => n.trim().toLowerCase() === "donordata");
  const rawSheet = workbook.SheetNames.find(n => n.trim().toLowerCase() === "rawupload");

  if (donorSheet) {
    return parseExistingDonorDataSheet(sheetToCellRows(workbook.Sheets[donorSheet]));
  }

  if (rawSheet) {
    return parseRawUploadSheet(sheetToCellRows(workbook.Sheets[rawSheet]));
  }

  const firstSheet = workbook.SheetNames[0];
  const rows = sheetToCellRows(workbook.Sheets[firstSheet]);
  const headerRow = findHeaderRow(rows, ["Donor_ID", "DONOR_ID", "Donor ID"]);
  if (headerRow >= 0) return parseRawUploadSheet(rows);
  return parseExistingDonorDataSheet(rows);
}

function parseExistingDonorDataSheet(rows) {
  const records = [];
  let skippedMissing = 0;
  const headerRow = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const donorId = normalizeDonorId(cellRawText(row[0], true));
    const phone = normalizePhone(cellRawText(row[1], true));
    const fullName = cellRawText(row[2], false).trim();
    const donationParsed = parseDateCell(row[3], "DMY", false);
    const dobParsed = parseDateCell(row[9], "DMY", true);
    const donationType = cellRawText(row[11], false).trim() || "Whole Blood";

    if (!donorId && !fullName) continue;
    if (!donorId || !fullName || !donationParsed.iso || !dobParsed.iso) {
      skippedMissing++;
      continue;
    }

    const status = cellRawText(row[8], false).trim() || "ส่งต่อให้ผู้ป่วยเรียบร้อยแล้ว";
    const idDoc = normalizeIdDocument(cellRawText(row[10], true));
    const unitNo = normalizeDonorId(cellRawText(row[13], true));

    records.push({
      donor_id: donorId,
      phone: phone,
      phone_last4: phoneLast4(phone || cellRawText(row[12], true)),
      full_name: fullName,
      donation_date: donationParsed.iso,
      donation_time: donationParsed.time,
      blood_group: cellRawText(row[4], false).trim(),
      donation_count: parseNumberCell(row[5]),
      sex: cellRawText(row[6], false).trim(),
      age: cellRawText(row[7], false).trim(),
      usage_status_public: status,
      dob: dobParsed.iso,
      id_document: idDoc,
      donation_type: donationType,
      unit_no_internal: unitNo || null,
      infectious_flag: status.includes("ติดต่อ"),
      raw_source: "DonorData"
    });
  }
  return { records, skippedNoUnit:0, skippedCannotDonate:0, skippedMissing, mode:"DonorData" };
}

function parseRawUploadSheet(rows) {
  const records = [];
  let skippedNoUnit = 0;
  let skippedCannotDonate = 0;
  let skippedMissing = 0;
  let headerRow = 2;
  const detected = findHeaderRow(rows, ["Donor_ID", "DONOR_ID", "Donor ID"]);
  if (detected >= 0) headerRow = detected;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const donorId = normalizeDonorId(cellRawText(row[0], true));
    const firstName = cellRawText(row[2], false).trim();
    const lastName = cellRawText(row[3], false).trim();
    const fullName = (firstName + " " + lastName).trim();
    const unitNoRaw = cellRawText(row[19], true).trim();
    const unitNoText = String(unitNoRaw || "").trim();

    if (!donorId && !fullName && !unitNoText) continue;
    if (!unitNoText) { skippedNoUnit++; continue; }
    if (unitNoText.includes("บริจาคไม่ได้")) { skippedCannotDonate++; continue; }

    const dobParsed = parseDateCell(row[7], "MDY", true);
    const donateParsed = parseDateCell(row[17], "MDY", false);
    const phone = normalizePhone(cellRawText(row[14], true));
    const donationType = cellRawText(row[18], false).trim() || "Whole Blood";

    if (!donorId || !fullName || !dobParsed.iso || !donateParsed.iso) {
      skippedMissing++;
      continue;
    }

    records.push({
      donor_id: donorId,
      phone: phone,
      phone_last4: phoneLast4(phone),
      full_name: fullName,
      donation_date: donateParsed.iso,
      donation_time: donateParsed.time,
      blood_group: convertBloodGroup(cellRawText(row[4], false)),
      donation_count: parseNumberCell(row[20]),
      sex: convertSex(cellRawText(row[6], false)),
      age: cellRawText(row[8], false).trim(),
      usage_status_public: "ส่งต่อให้ผู้ป่วยเรียบร้อยแล้ว",
      dob: dobParsed.iso,
      id_document: normalizeIdDocument(cellRawText(row[5], true)),
      donation_type: donationType,
      unit_no_internal: normalizeDonorId(unitNoText),
      infectious_flag: false,
      raw_source: "RawUpload"
    });
  }
  return { records, skippedNoUnit, skippedCannotDonate, skippedMissing, mode:"RawUpload" };
}

function resetDonorImportState() {
  pendingDonorImport = null;
  const previewBox = $("donorImportPreview");
  const resultBox = $("donorImportResult");
  const dataThroughDate = $("donorDataThroughDate")?.value || "";
  const btn = $("btnImportDonor");
  if (previewBox) { previewBox.style.display = "none"; previewBox.innerText = ""; }
  if (resultBox) { resultBox.style.display = "none"; resultBox.innerText = ""; }
  if (btn) btn.disabled = true;
}

function uniqueDonorRecords(records) {
  const seen = new Set();
  const unique = [];
  let duplicateInFile = 0;

  records.forEach(function(record) {
    const key = [record.donor_id, record.donation_date, record.donation_type || "Whole Blood"].join("|");
    if (seen.has(key)) {
      duplicateInFile++;
      return;
    }
    seen.add(key);
    unique.push(record);
  });

  return { unique, duplicateInFile };
}

function latestDonorContactRows(records) {
  const latest = new Map();
  (records || []).forEach(function(record) {
    const donorId = String(record.donor_id || "").trim();
    const phone = normalizePhone(record.phone || "");
    const donationDate = String(record.donation_date || "");
    if (!donorId || phone.length < 9 || !donationDate) return;
    const key = donorId.toUpperCase();
    const prev = latest.get(key);
    if (!prev || donationDate >= String(prev.donation_date || "")) {
      latest.set(key, {
        donor_id: donorId,
        phone: phone,
        full_name: record.full_name || "",
        dob: record.dob || "",
        id_document: record.id_document || "",
        donation_date: donationDate
      });
    }
  });
  return Array.from(latest.values());
}

async function previewDonorFile() {
  const file = $("donorImportFile").files[0];
  const btn = $("btnPreviewDonor");
  const importBtn = $("btnImportDonor");
  const previewBox = $("donorImportPreview");
  const resultBox = $("donorImportResult");

  if (!file) { setStaffResult(previewBox, "กรุณาเลือกไฟล์ Excel ก่อน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  if (resultBox) resultBox.style.display = "none";
  showBusy(btn, true, "ตรวจไฟล์ก่อนนำเข้า", "กำลังตรวจไฟล์...");

  try {
    const workbook = await readWorkbookFromFile(file);
    const parsed = parseDonorWorkbook(workbook);
    const deduped = uniqueDonorRecords(parsed.records || []);
    pendingDonorImport = {
      records: deduped.unique,
      parsed: parsed,
      fileName: file.name,
      duplicateInFile: deduped.duplicateInFile
    };

    const ready = deduped.unique.length;

    if (ready === 0) {
      if (importBtn) importBtn.disabled = true;
      setStaffResult(previewBox,
        "ตรวจไฟล์แล้ว แต่ยังไม่มีรายการที่พร้อมนำเข้า\n\n" +
        "โหมดไฟล์: " + (parsed.mode || "-") + "\n" +
        "ข้าม เพราะไม่มี Unit No: " + (parsed.skippedNoUnit || 0) + " รายการ\n" +
        "ข้าม เพราะบริจาคไม่ได้: " + (parsed.skippedCannotDonate || 0) + " รายการ\n" +
        "ข้าม เพราะข้อมูลสำคัญไม่ครบ: " + (parsed.skippedMissing || 0) + " รายการ\n" +
        "ข้อมูลซ้ำในไฟล์เดียวกัน: " + deduped.duplicateInFile + " รายการ",
        false
      );
      return;
    }

    if (importBtn) importBtn.disabled = !dataThroughDate;
    setStaffResult(previewBox,
      "ตรวจไฟล์เรียบร้อย รอยืนยันนำเข้า\n\n" +
      "ชื่อไฟล์: " + file.name + "\n" +
      "โหมดไฟล์: " + (parsed.mode || "-") + "\n" +
      "พร้อมส่งเข้า Supabase: " + ready + " รายการ\n" +
      "ข้าม เพราะไม่มี Unit No: " + (parsed.skippedNoUnit || 0) + " รายการ\n" +
      "ข้าม เพราะบริจาคไม่ได้: " + (parsed.skippedCannotDonate || 0) + " รายการ\n" +
      "ข้าม เพราะข้อมูลสำคัญไม่ครบ: " + (parsed.skippedMissing || 0) + " รายการ\n" +
      "ข้อมูลซ้ำในไฟล์เดียวกัน: " + deduped.duplicateInFile + " รายการ\n\n" +
      (dataThroughDate ? "ยืนยันว่าข้อมูลชุดนี้ล่าสุดถึง: " + isoToThaiDate(dataThroughDate, true) + "\n\n" : "⚠ กรุณาเลือก ‘ข้อมูลในไฟล์นี้อัปเดตล่าสุดถึงวันที่’ ก่อนยืนยันนำเข้า\n\n") +
      "ตรวจแล้วค่อยกด “ยืนยันนำเข้า Supabase” เพื่อบันทึกจริง",
      true
    );
  } catch (err) {
    pendingDonorImport = null;
    if (importBtn) importBtn.disabled = true;
    setStaffResult(previewBox, "ตรวจไฟล์ไม่สำเร็จ\n" + (err.message || err), false);
  } finally {
    showBusy(btn, false, "ตรวจไฟล์ก่อนนำเข้า", "กำลังตรวจไฟล์...");
  }
}

async function confirmImportDonorFile() {
  const btn = $("btnImportDonor");
  const box = $("donorImportResult");
  const previewBox = $("donorImportPreview");
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  if (!pendingDonorImport || !Array.isArray(pendingDonorImport.records) || pendingDonorImport.records.length === 0) {
    setStaffResult(box, "กรุณากดตรวจไฟล์ก่อนนำเข้า", false);
    return;
  }

  const dataThroughDate = $("donorDataThroughDate")?.value || "";
  if (!dataThroughDate) {
    setStaffResult(box, "กรุณาเลือก ‘ข้อมูลในไฟล์นี้อัปเดตล่าสุดถึงวันที่’ ก่อนยืนยันนำเข้า\n\nระบบจะใช้วันที่นี้จำว่าครั้งหน้าต้องอัปเดตข้อมูลต่อจากวันไหน", false);
    $("donorDataThroughDate")?.focus();
    return;
  }
  if (dataThroughDate > todayISO()) {
    setStaffResult(box, "วันที่ข้อมูลล่าสุดต้องไม่เกินวันนี้ กรุณาตรวจสอบวันที่อีกครั้ง", false);
    return;
  }

  const parsed = pendingDonorImport.parsed || {};
  const records = pendingDonorImport.records;
  const fileName = pendingDonorImport.fileName || "";
  const staffName = currentStaffDisplayName();

  showBusy(btn, true, "ยืนยันนำเข้า Supabase", "กำลังนำเข้า...");
  try {
    let sent = 0;
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const { error } = await sb.from("donor_donations").upsert(chunk, {
        onConflict: "donor_id,donation_date,donation_type",
        ignoreDuplicates: true
      });
      if (error) throw error;
      sent += chunk.length;
    }

    const latestContacts = latestDonorContactRows(records);
    for (let i = 0; i < latestContacts.length; i += chunkSize) {
      const contactChunk = latestContacts.slice(i, i + chunkSize);
      const { data:contactData, error:contactError } = await sb.rpc("upsert_donor_contacts_from_import", { p_rows: contactChunk });
      if (contactError || !contactData || contactData.ok !== true) {
        throw new Error(contactError?.message || contactData?.message || "อัปเดตเบอร์โทรปัจจุบันไม่สำเร็จ");
      }
    }

    const { error: logError } = await sb.from("import_logs").insert({
      import_type: "donor_import",
      imported_count: records.length,
      skipped_count: (parsed.skippedNoUnit || 0) + (parsed.skippedCannotDonate || 0) + (parsed.skippedMissing || 0) + (pendingDonorImport.duplicateInFile || 0),
      created_by: currentStaffProfile?.user_id || null,
      message: `data_through=${dataThroughDate}, by=${staffName}, mode=${parsed.mode || "-"}, file=${fileName}`
    });
    if (logError) throw new Error("นำเข้าข้อมูลสำเร็จ แต่บันทึกประวัติการนำเข้าไม่สำเร็จ: " + logError.message);

    setStaffResult(box,
      "นำเข้าข้อมูลผู้บริจาคเสร็จแล้ว\n\n" +
      "ชื่อไฟล์: " + fileName + "\n" +
      "ข้อมูลชุดนี้ล่าสุดถึง: " + isoToThaiDate(dataThroughDate, true) + "\n" +
      "อัปโหลดโดย: " + staffName + "\n" +
      "โหมดไฟล์: " + (parsed.mode || "-") + "\n" +
      "ส่งเข้า Supabase: " + sent + " รายการ\n" +
      "ข้าม เพราะไม่มี Unit No: " + (parsed.skippedNoUnit || 0) + " รายการ\n" +
      "ข้าม เพราะบริจาคไม่ได้: " + (parsed.skippedCannotDonate || 0) + " รายการ\n" +
      "ข้าม เพราะข้อมูลสำคัญไม่ครบ: " + (parsed.skippedMissing || 0) + " รายการ\n" +
      "ข้อมูลซ้ำในไฟล์เดียวกัน: " + (pendingDonorImport.duplicateInFile || 0) + " รายการ\n\n" +
      "หมายเหตุ: ประวัติเดิมที่ซ้ำจะไม่เพิ่มซ้ำ แต่เบอร์โทรปัจจุบันจะยึดจากข้อมูลวันที่ล่าสุดที่นำเข้า",
      true
    );

    pendingDonorImport = null;
    if (btn) btn.disabled = true;
    if (previewBox) previewBox.style.display = "none";
    if ($("donorDataThroughDate")) $("donorDataThroughDate").value = "";
    await loadDonorDataFreshness();
    loadStaffDashboard();
  } catch (err) {
    setStaffResult(box, "นำเข้าไม่สำเร็จ\n" + (err.message || err), false);
  } finally {
    showBusy(btn, false, "ยืนยันนำเข้า Supabase", "กำลังนำเข้า...");
  }
}

// compatibility เผื่อมีปุ่มเก่าค้าง cache
async function importDonorFile() {
  await previewDonorFile();
}

function setStaffResult(box, text, ok) {
  box.style.display = "block";
  box.className = "staff-result mt-3 " + (ok ? "ok" : "fail");
  box.innerText = text;
}

function parseInfectiousWorkbook(workbook) {
  const selected = getSheet(workbook, ["InfectiousResult", "Infectious", "Positive"]);
  const rows = sheetToCellRows(selected.sheet);
  let headerRow = findHeaderRow(rows, ["UnitNo", "Unit No", "DonorID", "Donor ID"]);
  if (headerRow < 0) headerRow = 0;
  const map = buildHeaderMap(rows, headerRow);
  const items = [];
  let skipped = 0;

  const hasResultColumn = ["result", "resultstatus", "status", "ผล", "ผลตรวจ"].some(h => map[normalizeHeader(h)] !== undefined);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const unitCell = getCellByHeader(row, map, ["UnitNo", "Unit No", "Unit", "BagNo", "Bag No", "เลขถุง"]);
    const donorCell = getCellByHeader(row, map, ["DonorID", "Donor ID", "DONOR_ID"]);
    const dateCell = getCellByHeader(row, map, ["DonateDate", "Donation Date", "วันที่บริจาค"]);
    const resultCell = getCellByHeader(row, map, ["ResultStatus", "Result", "Status", "ผล", "ผลตรวจ"]);

    const unitNo = normalizeDonorId(cellRawText(unitCell, true));
    const donorId = normalizeDonorId(cellRawText(donorCell, true));
    const dateParsed = parseDateCell(dateCell, "AUTO", false);
    const resultText = cellRawText(resultCell, false);

    const rowAllText = row.map(c => cellRawText(c, false)).join(" ");
    const isPositive = hasResultColumn
      ? /positive|reactive|detected|pos|\breact\b|บวก|พบ/i.test(resultText)
      : true;

    if (!isPositive) continue;
    if (!unitNo && !donorId) { skipped++; continue; }
    items.push({ unitNo, donorId, donationDate: dateParsed.iso, note: rowAllText.slice(0, 500) });
  }

  return { items, skipped, sheetName:selected.name };
}

async function importInfectiousFile() {
  const file = $("infectiousFile").files[0];
  const btn = $("btnImportInfectious");
  const box = $("infectiousResult");
  if (!file) { setStaffResult(box, "กรุณาเลือกไฟล์ Excel ก่อน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  showBusy(btn, true, "อัปเดตจากไฟล์ Excel", "กำลังอัปเดต...");
  try {
    const workbook = await readWorkbookFromFile(file);
    const parsed = parseInfectiousWorkbook(workbook);
    const result = await updateInfectiousItems(parsed.items);
    await sb.from("import_logs").insert({
      import_type: "infectious_update",
      imported_count: result.updated,
      skipped_count: parsed.skipped + result.notFound,
      created_by: currentStaffProfile?.user_id || null,
      message: `by=${currentStaffDisplayName()}, sheet=${parsed.sheetName}, file=${file.name}`
    });
    setStaffResult(box,
      "อัปเดต infectious positive เสร็จแล้ว\n\n" +
      "อ่านจากชีต: " + parsed.sheetName + "\n" +
      "รายการ positive ในไฟล์: " + parsed.items.length + " รายการ\n" +
      "อัปเดตสำเร็จ: " + result.updated + " รายการ\n" +
      "ไม่พบในฐานข้อมูล: " + result.notFound + " รายการ\n" +
      "ข้าม เพราะไม่มี Unit No/Donor ID: " + parsed.skipped + " รายการ\n\n" +
      "หน้าเว็บผู้บริจาคจะเห็นเป็น: กรุณาติดต่อเจ้าหน้าที่ห้องบริจาคโลหิต",
      true
    );
  } catch (err) {
    setStaffResult(box, "อัปเดตไม่สำเร็จ\n" + (err.message || err), false);
  } finally {
    showBusy(btn, false, "อัปเดตจากไฟล์ Excel", "กำลังอัปเดต...");
  }
}

async function updateInfectiousItems(items) {
  let updated = 0;
  let notFound = 0;

  for (const item of items) {
    let count = 0;

    // ลำดับ match: Unit No แม่นที่สุด → Donor ID + วันที่ → Donor ID
    if (item.unitNo) {
      const { data, error } = await sb.from("donor_donations")
        .update({
          infectious_flag: true,
          usage_status_public: "กรุณาติดต่อเจ้าหน้าที่ห้องบริจาคโลหิต",
          infectious_note_internal: item.note || "infectious positive"
        })
        .select("id")
        .eq("unit_no_internal", item.unitNo);
      if (error) throw error;
      count = Array.isArray(data) ? data.length : 0;
    }

    if (count === 0 && item.donorId && item.donationDate) {
      const { data, error } = await sb.from("donor_donations")
        .update({
          infectious_flag: true,
          usage_status_public: "กรุณาติดต่อเจ้าหน้าที่ห้องบริจาคโลหิต",
          infectious_note_internal: item.note || "infectious positive"
        })
        .select("id")
        .eq("donor_id", item.donorId)
        .eq("donation_date", item.donationDate);
      if (error) throw error;
      count = Array.isArray(data) ? data.length : 0;
    }

    if (count === 0 && item.donorId) {
      const { data, error } = await sb.from("donor_donations")
        .update({
          infectious_flag: true,
          usage_status_public: "กรุณาติดต่อเจ้าหน้าที่ห้องบริจาคโลหิต",
          infectious_note_internal: item.note || "infectious positive"
        })
        .select("id")
        .eq("donor_id", item.donorId);
      if (error) throw error;
      count = Array.isArray(data) ? data.length : 0;
    }

    if (count > 0) updated += count;
    else notFound++;
  }

  return { updated, notFound };
}

async function updateInfectiousFromTextArea() {
  const text = $("infectiousUnitList").value;
  const btn = $("btnUpdateUnitList");
  const box = $("infectiousResult");
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  const unitNos = text.split(/\r?\n/).map(x => normalizeDonorId(x)).filter(Boolean);
  const unique = Array.from(new Set(unitNos));
  if (unique.length === 0) { setStaffResult(box, "กรุณาวาง Unit No อย่างน้อย 1 รายการ", false); return; }

  showBusy(btn, true, "อัปเดตจากรายการ Unit No", "กำลังอัปเดต...");
  try {
    const items = unique.map(u => ({ unitNo:u, note:"manual unit list" }));
    const result = await updateInfectiousItems(items);
    setStaffResult(box, "อัปเดตจากรายการ Unit No เสร็จแล้ว\n\nรายการทั้งหมด: " + unique.length + "\nอัปเดตสำเร็จ: " + result.updated + "\nไม่พบในฐานข้อมูล: " + result.notFound, true);
  } catch (err) {
    setStaffResult(box, "อัปเดตไม่สำเร็จ\n" + (err.message || err), false);
  } finally {
    showBusy(btn, false, "อัปเดตจากรายการ Unit No", "กำลังอัปเดต...");
  }
}

async function preparePlateletMonth() {
  const month = $("plateletMonth").value;
  const box = $("slotResult");
  const btn = $("btnPreparePlateletMonth");
  if (!month) { setStaffResult(box, "กรุณาเลือกเดือน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  showBusy(btn, true, "เตรียมตาราง", "กำลังเตรียม...");
  const { data, error } = await sb.rpc("prepare_platelet_month", { p_month:month });
  showBusy(btn, false, "เตรียมตาราง", "กำลังเตรียม...");
  if (error || !data || data.ok !== true) setStaffResult(box, "เตรียมตารางไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, "เตรียมตาราง " + thaiMonthLabel(month) + " สำเร็จ\nวันจันทร์–ศุกร์ · 09:00 และ 13:00 · รอบละ 2 คน", true);
  await loadPlateletMonthAdmin();
}

async function publishPlateletMonth(published) {
  const month = $("plateletMonth").value;
  const box = $("slotResult");
  const btn = published ? $("btnPublishPlateletMonth") : $("btnUnpublishPlateletMonth");
  if (!month) { setStaffResult(box, "กรุณาเลือกเดือน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const verb = published ? "เปิดจองเดือนนี้" : "ปิดรอบเดือน";
  showBusy(btn, true, verb, published ? "กำลังเปิดจอง..." : "กำลังปิดรอบ...");
  const { data, error } = await sb.rpc("set_platelet_month_published", { p_month:month, p_published:published });
  showBusy(btn, false, verb, published ? "กำลังเปิดจอง..." : "กำลังปิดรอบ...");
  if (error || !data || data.ok !== true) setStaffResult(box, (published ? "เปิดจอง" : "ปิดรอบ") + "ไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, data.message || (published ? "เปิดจองเดือนนี้แล้ว" : "ปิดรอบเดือนนี้แล้ว"), true);
  await loadPlateletMonthAdmin();
}

async function setPlateletSlotClosed(closed) {
  const bookingDate = $("plateletCloseDate").value;
  const scope = $("plateletCloseScope").value;
  const reason = $("plateletCloseReason").value.trim();
  const box = $("slotResult");
  const btn = closed ? $("btnClosePlateletSlot") : $("btnOpenPlateletSlot");
  if (!bookingDate) { setStaffResult(box, "กรุณาเลือกวันที่", false); return; }
  if (closed && !reason) { setStaffResult(box, "กรุณาระบุเหตุผลภายในก่อนงดรับ", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  showBusy(btn, true, closed ? "งดรับช่วงนี้" : "เปิดรับอีกครั้ง", "กำลังบันทึก...");
  const { data, error } = await sb.rpc("set_platelet_slot_closed", {
    p_booking_date:bookingDate, p_scope:scope, p_closed:closed, p_reason:reason
  });
  showBusy(btn, false, closed ? "งดรับช่วงนี้" : "เปิดรับอีกครั้ง", "กำลังบันทึก...");
  if (error || !data || data.ok !== true) setStaffResult(box, "บันทึกไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else {
    const contact = Number(data.contactBookings || 0);
    setStaffResult(box, (closed ? "งดรับเรียบร้อย" : "เปิดรับเรียบร้อย") + (contact > 0 ? "\nมีคิวเดิม " + contact + " รายการ ถูกเปลี่ยนเป็น ‘ต้องติดต่อ’" : ""), true);
  }
  await loadPlateletMonthAdmin();
  if ($("bookingListDate")) $("bookingListDate").value = bookingDate;
}

function selectPlateletAdminDate(value) {
  if ($("plateletCloseDate")) $("plateletCloseDate").value = value;
  const el = $("plateletCloseDate"); if (el) el.focus({ preventScroll:true });
}

function calendarSlotHtml(slot, used, bookingDate) {
  if (!slot) return '<div class="platelet-slot-mini missing"><b>-</b><span>ยังไม่เตรียม</span></div>';
  const time = String(slot.time_slot || "").slice(0,5);
  const closed = slot.status === "ปิด";
  const count = Number(used || 0);
  const hasBooking = count > 0;
  const content = '<b>' + escapeHtml(time) + '</b><span>' + (closed ? (hasBooking ? escapeHtml(String(count)) + ' คิว · งดรับ' : 'งดรับ') : escapeHtml(String(count)) + '/' + escapeHtml(String(slot.max_queue || 2))) + '</span>';
  if (!hasBooking) return '<div class="platelet-slot-mini ' + (closed ? 'closed' : '') + '">' + content + '</div>';
  return '<button type="button" class="platelet-slot-mini has-booking ' + (closed ? 'closed' : '') + '" title="ดูรายละเอียดผู้จอง" onclick="event.stopPropagation(); showPlateletSlotDetails(\'' + bookingDate + '\',\'' + time + '\')">' + content + '</button>';
}

async function showPlateletSlotDetails(bookingDate, timeSlot) {
  const isStaff = await ensureStaff(false); if (!isStaff) return;
  const { data, error } = await sb.from("bookings")
    .select("booking_id,public_code,full_name,phone,email,donor_id,booking_date,time_slot,status,note,created_at")
    .eq("booking_date", bookingDate)
    .eq("time_slot", timeSlot)
    .eq("donation_type", "Platelet")
    .neq("status", "ยกเลิก")
    .order("created_at", { ascending:true });
  if (error) {
    showModal({ title:"โหลดรายละเอียดไม่สำเร็จ", message:error.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  const heading = isoToThaiDate(bookingDate, true) + " · " + timeSlot + " น.";
  const message = rows.length ? rows.map((r, i) => [
    (i + 1) + ". " + (r.full_name || "-"),
    "เลขนัด " + (r.public_code || r.booking_id || "-"),
    "โทร " + (r.phone || "-") + (r.email ? " · " + r.email : ""),
    "Donor ID " + (r.donor_id || "-"),
    "สถานะ " + (r.status || "-"),
    r.note ? "หมายเหตุ " + r.note : ""
  ].filter(Boolean).join("\n")).join("\n\n") : "ยังไม่มีผู้จองในรอบนี้";
  showModal({
    title:"คิวเกล็ดเลือด " + heading,
    message,
    iconText:String(rows.length || "0"),
    primaryText:"ดูรายการของวันนี้",
    secondaryText:"ปิด",
    onPrimary:() => {
      if ($("bookingListDate")) $("bookingListDate").value = bookingDate;
      showStaffTab("bookings");
    }
  });
}

async function loadPlateletMonthAdmin() {
  const monthInput = $("plateletMonth");
  const calendar = $("plateletMonthCalendar");
  if (!monthInput || !calendar) return;
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const range = monthRange(month); if (!range) return;
  const isStaff = await ensureStaff(false); if (!isStaff) return;
  calendar.innerHTML = '<div class="staff-result">กำลังโหลดตาราง...</div>';

  const [{ data:monthRows, error:monthErr }, { data:slots, error:slotErr }, { data:bookings, error:bookErr }] = await Promise.all([
    sb.from("platelet_booking_months").select("month_start,is_published,published_at").eq("month_start", range.start).limit(1),
    sb.from("booking_slots").select("booking_date,time_slot,max_queue,status,note").gte("booking_date", range.start).lte("booking_date", range.end).order("booking_date").order("time_slot"),
    sb.from("bookings").select("booking_date,time_slot,status").eq("donation_type","Platelet").gte("booking_date", range.start).lte("booking_date", range.end).neq("status","ยกเลิก")
  ]);
  if (monthErr || slotErr || bookErr) {
    calendar.innerHTML = '<div class="staff-result fail">โหลดตารางไม่สำเร็จ<br>' + escapeHtml(monthErr?.message || slotErr?.message || bookErr?.message || "") + '</div>';
    return;
  }

  const monthRow = Array.isArray(monthRows) && monthRows.length ? monthRows[0] : null;
  const published = !!(monthRow && monthRow.is_published);
  if ($("plateletMonthStatus")) {
    $("plateletMonthStatus").innerText = published ? "เปิดให้ผู้บริจาคจองแล้ว" : (monthRow ? "ฉบับร่าง · ยังไม่เปิดจอง" : "ยังไม่ได้เตรียมตาราง");
    $("plateletMonthStatus").className = published ? "published" : "draft";
  }
  if ($("plateletMonthHint")) $("plateletMonthHint").innerText = published ? "ผู้บริจาคเห็นคิวเดือนนี้แล้ว" : "เติมวันงดรับให้เรียบร้อยก่อนกดเปิดจอง";

  const slotMap = {};
  (slots || []).forEach(r => { const d=String(r.booking_date); const t=String(r.time_slot).slice(0,5); (slotMap[d] ||= {})[t]=r; });
  const usedMap = {};
  (bookings || []).forEach(r => { const key=String(r.booking_date)+'|'+String(r.time_slot).slice(0,5); usedMap[key]=(usedMap[key]||0)+1; });

  const first = new Date(range.year, range.month - 1, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const headers = ["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  let html = '<div class="platelet-calendar-head">' + headers.map(h=>'<div>'+h+'</div>').join('') + '</div><div class="platelet-calendar-grid">';
  for (let i=0;i<offset;i++) html += '<div class="platelet-day-cell empty"></div>';
  for (let day=1; day<=range.days; day++) {
    const iso = month + '-' + pad2(day);
    const dt = new Date(range.year, range.month - 1, day, 12);
    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
    if (weekend) {
      html += '<div class="platelet-day-cell weekend"><div class="platelet-day-number">'+day+'</div><span>ไม่เปิด</span></div>';
    } else {
      const sm = slotMap[iso] || {};
      const bothClosed = sm['09:00']?.status === 'ปิด' && sm['13:00']?.status === 'ปิด';
      html += '<div class="platelet-day-cell weekday ' + (bothClosed ? 'day-closed' : '') + '" role="button" tabindex="0" onclick="selectPlateletAdminDate(\''+iso+'\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();selectPlateletAdminDate(\''+iso+'\')}">' +
        '<div class="platelet-day-number">'+day+'</div>' +
        '<div class="platelet-mini-grid">' + calendarSlotHtml(sm['09:00'], usedMap[iso+'|09:00'], iso) + calendarSlotHtml(sm['13:00'], usedMap[iso+'|13:00'], iso) + '</div>' +
        '</div>';
    }
  }
  html += '</div>';
  calendar.innerHTML = html;
}

async function loadStaffBookings() {
  const date = $("bookingListDate")?.value || todayISO();
  const box = $("staffBookingsResult");
  if (!box) return;
  if ($("bookingListDate") && !$("bookingListDate").value) $("bookingListDate").value = date;
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  box.innerHTML = '<div class="staff-result">กำลังโหลด...</div>';
  const { data, error } = await sb.from("bookings")
    .select("booking_id,public_code,full_name,phone,email,donor_id,booking_date,time_slot,donation_type,status,note")
    .eq("booking_date", date)
    .eq("donation_type", "Platelet")
    .order("time_slot", { ascending:true });
  if (error) {
    box.innerHTML = '<div class="staff-result fail">โหลดไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>';
    await loadPlateletBookingAuditLog();
    return;
  }
  if (!data || data.length === 0) {
    box.innerHTML = '<div class="staff-result">ไม่พบรายการจองเกล็ดเลือดในวันนี้</div>';
    await loadPlateletBookingAuditLog();
    return;
  }
  box.innerHTML = '<table class="table table-sm preview-table mobile-card-table"><thead><tr><th>เวลา</th><th>เลขนัด</th><th>ชื่อ</th><th>โทร / อีเมล</th><th>Donor ID</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>' +
    data.map(r => {
      const safeId = encodeURIComponent(String(r.booking_id || ""));
      const safeName = encodeURIComponent(String(r.full_name || ""));
      const safeDate = encodeURIComponent(String(r.booking_date || ""));
      const safeTime = encodeURIComponent(String(r.time_slot || "").slice(0,5));
      const statusClass = r.status === 'ต้องติดต่อ' ? 'booking-status-contact' : (r.status === 'ยกเลิก' ? 'booking-status-cancel' : 'booking-status-ok');
      const statusActions = r.status === 'ต้องติดต่อ'
        ? "<button type='button' class='btn btn-sm btn-outline-success me-1' onclick=\"staffSetPlateletBookingStatus(decodeURIComponent('" + safeId + "'),'จองแล้ว')\">ยืนยันคิว</button><button type='button' class='btn btn-sm btn-outline-secondary me-1' onclick=\"staffSetPlateletBookingStatus(decodeURIComponent('" + safeId + "'),'ยกเลิก')\">ยกเลิกคิว</button>"
        : (r.status !== 'ยกเลิก' ? "<button type='button' class='btn btn-sm btn-outline-secondary me-1' onclick=\"staffSetPlateletBookingStatus(decodeURIComponent('" + safeId + "'),'ยกเลิก')\">ยกเลิกคิว</button>" : '');
      const deleteAction = "<button type='button' class='btn btn-sm btn-outline-danger' onclick=\"confirmStaffDeletePlateletBooking(decodeURIComponent('" + safeId + "'),decodeURIComponent('" + safeName + "'),decodeURIComponent('" + safeDate + "'),decodeURIComponent('" + safeTime + "'))\"><i class='bi bi-trash3'></i> ลบรายการ</button>";
      const actions = statusActions + deleteAction;
      return '<tr>' +
        '<td data-label="เวลา">' + escapeHtml(String(r.time_slot).slice(0,5)) + '</td>' +
        '<td data-label="เลขนัด">' + escapeHtml(r.public_code || r.booking_id || '') + '</td>' +
        '<td data-label="ชื่อ">' + escapeHtml(r.full_name) + '</td>' +
        '<td data-label="ติดต่อ"><a href="tel:' + escapeHtml(r.phone) + '">' + escapeHtml(r.phone) + '</a>' + (r.email ? '<br><a class="mail-link-btn" href="' + escapeHtml(buildMailtoHref(r.email, 'CNMI Blood Donation — นัดบริจาคเกล็ดเลือด', 'เรียน ' + (r.full_name || '') + '\n\nเกี่ยวกับนัดบริจาคเกล็ดเลือด เลขนัด ' + (r.public_code || r.booking_id || '') + '\nวันที่ ' + isoToThaiDate(r.booking_date, true) + ' เวลา ' + String(r.time_slot).slice(0,5) + ' น.\n\nห้องบริจาคโลหิต CNMI')) + '"><i class="bi bi-envelope"></i> ' + escapeHtml(r.email) + '</a>' : '') + '</td>' +
        '<td data-label="Donor ID">' + escapeHtml(r.donor_id || '') + '</td>' +
        '<td data-label="สถานะ"><span class="booking-status-pill ' + statusClass + '">' + escapeHtml(r.status) + '</span></td>' +
        '<td data-label="จัดการ"><div class="booking-row-actions">' + actions + '</div></td>' +
        '</tr>';
    }).join("") +
    '</tbody></table>';
  await loadPlateletBookingAuditLog();
}

async function staffSetPlateletBookingStatus(bookingId, status) {
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("staff_set_platelet_booking_status", { p_booking_id:bookingId, p_status:status });
  if (error || !data || data.ok !== true) {
    showModal({ title:"บันทึกไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  syncStaffPlannerEvent("platelet", bookingId, "status");
  await loadStaffBookings();
  await loadPlateletMonthAdmin();
}

function confirmStaffDeletePlateletBooking(bookingId, fullName, bookingDate, timeSlot) {
  const label = [fullName || "-", bookingDate ? isoToThaiDate(bookingDate, true) : "", timeSlot ? timeSlot + " น." : ""].filter(Boolean).join(" · ");
  showModal({
    title:"ยืนยันลบรายการจอง",
    message:"รายการนี้จะหายจากคิวและปฏิทินทันที แต่ระบบจะเก็บ Audit Log ว่าใครเป็นผู้ลบ พร้อมข้อมูลก่อนลบไว้ตรวจสอบย้อนหลัง\n\n" + label,
    iconText:"!",
    primaryText:"ลบรายการ",
    secondaryText:"ยกเลิก",
    onPrimary:function(){ staffDeletePlateletBooking(bookingId); }
  });
}

async function staffDeletePlateletBooking(bookingId) {
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("staff_delete_platelet_booking", { p_booking_id:bookingId });
  if (error || !data || data.ok !== true) {
    showModal({ title:"ลบรายการไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  syncStaffPlannerEvent("platelet", bookingId, "delete");
  await loadStaffBookings();
  await loadPlateletMonthAdmin();
  await refreshStaffNotificationBadge();
  showModal({ title:"ลบรายการแล้ว", message:"ลบคิว " + (data.publicCode || bookingId) + " เรียบร้อยแล้ว\nระบบเก็บชื่อผู้ดำเนินการ วันเวลา และข้อมูลก่อนลบไว้ใน Audit Log", iconText:"✓", type:"success" });
}

async function loadPlateletBookingAuditLog() {
  const box = $("bookingAuditResult"); if (!box || !currentStaffProfile) return;
  const date = $("bookingListDate")?.value || todayISO();
  box.innerHTML = '<div class="staff-result">กำลังโหลดประวัติ...</div>';
  const { data, error } = await sb.from("staff_booking_audit_log")
    .select("id,booking_id,public_code,booking_date,time_slot,full_name,action,old_status,new_status,acted_by_name,acted_by_email,created_at")
    .eq("donation_type", "Platelet")
    .eq("booking_date", date)
    .order("created_at", { ascending:false })
    .limit(50);
  if (error) {
    box.innerHTML = '<div class="staff-result fail">โหลด Audit Log ไม่สำเร็จ<br>' + escapeHtml(error.message || '') + '</div>';
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    box.innerHTML = '<div class="staff-result">ยังไม่มีประวัติการแก้ไขหรือลบคิวในวันที่เลือก</div>';
    return;
  }
  box.innerHTML = '<div class="booking-audit-list">' + rows.map(r => {
    const actionLabel = r.action === 'delete' ? 'ลบรายการ' : 'เปลี่ยนสถานะ';
    const actionClass = r.action === 'delete' ? 'audit-delete' : 'audit-status';
    const statusText = r.action === 'status_change' ? (' · ' + escapeHtml(r.old_status || '-') + ' → ' + escapeHtml(r.new_status || '-')) : '';
    const actor = r.acted_by_name || r.acted_by_email || 'เจ้าหน้าที่';
    return '<article class="booking-audit-item ' + actionClass + '">' +
      '<div><b>' + escapeHtml(actionLabel) + '</b><span>' + escapeHtml(r.public_code || r.booking_id || '-') + ' · ' + escapeHtml(r.full_name || '-') + statusText + '</span></div>' +
      '<small><i class="bi bi-person-check"></i> ' + escapeHtml(actor) + ' · ' + escapeHtml(formatBangkokLogTime(r.created_at, true)) + '</small>' +
    '</article>';
  }).join('') + '</div>';
}


function calendarMonthOffset(range) {
  const first = new Date(range.year, range.month - 1, 1, 12);
  return (first.getDay() + 6) % 7;
}

function roomEventMeta(type) {
  const map = {
    closed: { label:"ปิดทำการ", icon:"bi-x-circle", className:"event-closed" },
    limited: { label:"รับจำนวนจำกัด", icon:"bi-people", className:"event-limited" },
    mobile_unit: { label:"ออกหน่วย · ห้องปิด", icon:"bi-truck", className:"event-mobile" },
    activity: { label:"กิจกรรม", icon:"bi-megaphone", className:"event-activity" },
    open: { label:"เปิดทำการ", icon:"bi-check-circle", className:"event-open" }
  };
  return map[type] || map.activity;
}

function selectGroupPublicDate(value) {
  const hidden = $("groupDate");
  const display = $("groupSelectedDate");
  if (hidden) hidden.value = value;
  if (display) {
    display.classList.add("selected");
    display.innerHTML = '<i class="bi bi-calendar-check"></i><span><b>' + escapeHtml(isoToThaiDate(value, true)) + '</b><small>วันที่ที่เลือกสำหรับส่งคำขอ</small></span>';
  }
  document.querySelectorAll(".group-public-day.selected").forEach(el => el.classList.remove("selected"));
  const target = document.querySelector('.group-public-day[data-date="' + value + '"]');
  if (target) target.classList.add("selected");
}

async function loadGroupPublicCalendar(allowAutoNext) {
  const monthInput = $("groupPublicMonth");
  const calendar = $("groupPublicCalendar");
  if (!monthInput || !calendar) return;
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const range = monthRange(month);
  if (!range) return;

  calendar.innerHTML = '<div class="empty-state-inline">กำลังโหลดวันที่เปิดรับ...</div>';
  const { data, error } = await sb.rpc("get_group_booking_calendar", { p_month:month });
  if (error || !data || data.ok !== true) {
    calendar.innerHTML = '<div class="public-calendar-message error"><i class="bi bi-exclamation-circle"></i><span>โหลดตารางไม่สำเร็จ กรุณาลองใหม่</span></div>';
    return;
  }

  if (!data.published) {
    if (allowAutoNext !== false && month === currentMonthValue()) {
      const next = nextMonthValue();
      const probe = await sb.rpc("get_group_booking_calendar", { p_month:next });
      if (!probe.error && probe.data && probe.data.ok === true && probe.data.published) {
        monthInput.value = next;
        return loadGroupPublicCalendar(false);
      }
    }
    calendar.innerHTML = '<div class="public-calendar-message"><i class="bi bi-calendar2-week"></i><div><b>เดือนนี้ยังไม่เปิดรับคำขอหมู่คณะ</b><span>กรุณาเลือกเดือนอื่น หรือติดต่อเจ้าหน้าที่</span></div></div>';
    return;
  }

  const dayMap = {};
  (data.days || []).forEach(d => dayMap[d.date] = d);
  const headers = ["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  let html = '<div class="availability-calendar-head">' + headers.map(h => '<div>' + h + '</div>').join('') + '</div><div class="availability-calendar-grid">';
  const offset = calendarMonthOffset(range);
  for (let i = 0; i < offset; i++) html += '<div class="group-public-day empty"></div>';
  const today = todayISO();

  for (let day = 1; day <= range.days; day++) {
    const iso = month + "-" + pad2(day);
    const row = dayMap[iso];
    const past = iso < today;
    const open = !past && row && row.open === true;

    if (open) {
      html += '<button type="button" class="group-public-day open" data-date="' + iso + '" onclick="selectGroupPublicDate(\'' + iso + '\')"><b>' + day + '</b><span>เปิดรับ</span></button>';
    } else {
      let reason = past ? "ผ่านแล้ว" : "งดรับ";
      if (!past && row && row.leadTimeOk === false) reason = "ไม่ถึง 24 ชม.";
      else if (!past && row && row.roomOpen === false) reason = "ห้องปิด";
      html += '<div class="group-public-day closed ' + (past ? 'past' : '') + '"><b>' + day + '</b><span>' + escapeHtml(reason) + '</span></div>';
    }
  }
  html += '</div>';
  calendar.innerHTML = html;

  const selected = $("groupDate")?.value;
  if (selected && selected.startsWith(month + "-") && dayMap[selected]?.open) selectGroupPublicDate(selected);
  else {
    if ($("groupDate")) $("groupDate").value = "";
    const display = $("groupSelectedDate");
    if (display) {
      display.classList.remove("selected");
      display.innerHTML = '<i class="bi bi-calendar-check"></i><span>กรุณาเลือกวันที่จากตารางด้านบน</span>';
    }
  }
}

async function prepareGroupBookingMonth() {
  const month = $("groupAdminMonth")?.value;
  const box = $("groupAdminResult");
  if (!month) { setStaffResult(box, "กรุณาเลือกเดือน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("prepare_group_booking_month", { p_month:month });
  if (error || !data || data.ok !== true) setStaffResult(box, "เตรียมตารางไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, "เตรียมตารางหมู่คณะ " + thaiMonthLabel(month) + " แล้ว\nวันจันทร์–ศุกร์จะเปิดรับเป็นค่าเริ่มต้น จากนั้นปิดเฉพาะวันที่ไม่สะดวกได้", true);
  await loadGroupBookingMonthAdmin();
}

async function publishGroupBookingMonth(published) {
  const month = $("groupAdminMonth")?.value;
  const box = $("groupAdminResult");
  if (!month) { setStaffResult(box, "กรุณาเลือกเดือน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("set_group_booking_month_published", { p_month:month, p_published:!!published });
  if (error || !data || data.ok !== true) setStaffResult(box, (published ? "เปิดรับ" : "ปิดรอบ") + "ไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, published ? "เปิดรับคำขอหมู่คณะเดือนนี้แล้ว" : "ปิดรับคำขอหมู่คณะเดือนนี้แล้ว", true);
  await loadGroupBookingMonthAdmin();
}

async function setGroupBookingDayOpen(open) {
  const date = $("groupAdminDate")?.value;
  const note = $("groupAdminNote")?.value.trim() || "";
  const box = $("groupAdminResult");
  if (!date) { setStaffResult(box, "กรุณาเลือกวันที่", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("set_group_booking_day_open", { p_booking_date:date, p_open:!!open, p_note:note });
  if (error || !data || data.ok !== true) {
    setStaffResult(box, "บันทึกไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  } else {
    const affected = Number(data.affectedRequests || 0);
    setStaffResult(box, (open ? "นำวันที่นี้กลับไปอิงตามปฏิทินห้องแล้ว" : "งดรับหมู่คณะวันที่นี้แล้ว") + (affected ? "\nมีคำขอเดิม " + affected + " รายการ เปลี่ยนเป็น “ต้องติดต่อ”" : ""), true);
  }
  await loadGroupBookingMonthAdmin();
}

function selectGroupAdminDate(value) {
  if ($("groupAdminDate")) $("groupAdminDate").value = value;
  const row = currentGroupAdminDays.find(d => d.date === value);
  if ($("groupAdminNote")) $("groupAdminNote").value = row?.note || "";
}

async function loadGroupBookingMonthAdmin() {
  const monthInput = $("groupAdminMonth");
  const calendar = $("groupAdminCalendar");
  if (!monthInput || !calendar) return;
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const range = monthRange(month); if (!range) return;
  const isStaff = await ensureStaff(false); if (!isStaff) return;

  calendar.innerHTML = '<div class="staff-result">กำลังโหลดตาราง...</div>';
  const { data, error } = await sb.rpc("get_group_booking_calendar", { p_month:month });
  if (error || !data || data.ok !== true) {
    calendar.innerHTML = '<div class="staff-result fail">โหลดตารางไม่สำเร็จ<br>' + escapeHtml(error?.message || data?.message || "") + '</div>';
    return;
  }

  currentGroupAdminDays = Array.isArray(data.days) ? data.days : [];
  if ($("groupAdminMonthStatus")) {
    $("groupAdminMonthStatus").innerText = data.published ? "ปฏิทินห้องเผยแพร่แล้ว" : "ปฏิทินห้องยังไม่เผยแพร่";
    $("groupAdminMonthStatus").className = data.published ? "published" : "draft";
  }
  if ($("groupAdminMonthHint")) $("groupAdminMonthHint").innerText = data.published ? "วันเปิดรับหมู่คณะอิงจากตารางห้องโดยอัตโนมัติ" : "ผู้บริจาคจะยังเลือกวันไม่ได้จนกว่าจะเผยแพร่ตารางเปิด–ปิดห้อง";

  const dayMap = {};
  currentGroupAdminDays.forEach(d => dayMap[d.date] = d);
  const headers = ["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  let html = '<div class="platelet-calendar-head">' + headers.map(h => '<div>' + h + '</div>').join('') + '</div><div class="platelet-calendar-grid">';
  const offset = calendarMonthOffset(range);
  for (let i=0;i<offset;i++) html += '<div class="platelet-day-cell empty"></div>';
  for (let day=1; day<=range.days; day++) {
    const iso = month + "-" + pad2(day);
    const row = dayMap[iso];
    if (!row) {
      html += '<button type="button" class="platelet-day-cell weekday group-unprepared" onclick="selectGroupAdminDate(\'' + iso + '\')"><div class="platelet-day-number">' + day + '</div><span>ไม่มีข้อมูล</span></button>';
      continue;
    }

    let cls = row.open ? 'group-open' : 'day-closed';
    let label = row.open ? 'เปิดรับ' : 'งดรับ';
    let sub = escapeHtml(String(row.requests || 0)) + ' คำขอ';
    let note = row.note || "";
    if (row.roomOpen === false) {
      cls = 'day-closed';
      label = 'ห้องปิด';
      sub = row.roomTitle ? escapeHtml(row.roomTitle) : 'อิงปฏิทินห้อง';
    } else if (row.groupBlocked) {
      cls = 'day-closed';
      label = 'งดรับหมู่คณะ';
      sub = escapeHtml(String(row.requests || 0)) + ' คำขอ';
    } else if (row.leadTimeOk === false) {
      cls = 'group-open';
      label = 'เปิดตามตารางห้อง';
      sub = 'เลยช่วงจอง 24 ชม.';
    }

    html += '<button type="button" class="platelet-day-cell weekday group-day ' + cls + '" onclick="selectGroupAdminDate(\'' + iso + '\')">' +
      '<div class="platelet-day-number">' + day + '</div>' +
      '<div class="group-day-status"><b>' + label + '</b><span>' + sub + '</span></div>' +
      (note ? '<small class="group-day-note">' + escapeHtml(note) + '</small>' : '') +
      '</button>';
  }
  html += '</div>';
  calendar.innerHTML = html;
}

function showRoomCalendarPublic() {
  showPage("roomCalendar");
}

function roomRegularHours(dateIso) {
  const parts = String(dateIso || "").split("-").map(Number);
  const d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0) : new Date();
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return weekend ? {
    dayLabel:"เสาร์–อาทิตย์",
    morning:"09:30–11:30",
    afternoon:"13:00–16:30",
    breakTime:"12:00–13:00",
    compact:"09:30–11:30 · 13:00–16:30",
    full:"09:30–11:30 น. และ 13:00–16:30 น."
  } : {
    dayLabel:"จันทร์–ศุกร์",
    morning:"08:30–11:30",
    afternoon:"13:00–15:30",
    breakTime:"12:00–13:00",
    compact:"08:30–11:30 · 13:00–15:30",
    full:"08:30–11:30 น. และ 13:00–15:30 น."
  };
}

function roomHoursForEvent(dateIso, event) {
  const regular = roomRegularHours(dateIso);
  if (!event) return { show:true, text:regular.compact, full:regular.full, breakTime:regular.breakTime, custom:false };
  if (event.type === "closed" || event.type === "mobile_unit") {
    return { show:!!event.time, text:event.time || "", full:event.time || "", breakTime:"", custom:!!event.time };
  }
  if (event.time) return { show:true, text:event.time, full:event.time, breakTime:"", custom:true };
  return { show:true, text:regular.compact, full:regular.full, breakTime:regular.breakTime, custom:false };
}

function thaiWeekdayClass(dateIso) {
  const parts = String(dateIso || "").split("-").map(Number);
  if (parts.length !== 3) return "thai-day-mon";
  const day = new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0).getDay();
  return ["thai-day-sun","thai-day-mon","thai-day-tue","thai-day-wed","thai-day-thu","thai-day-fri","thai-day-sat"][day] || "thai-day-mon";
}

function roomCalendarCellHtml(day, iso, range, event, clickable, publicMode) {
  const meta = event ? roomEventMeta(event.type) : null;
  const hours = roomHoursForEvent(iso, event);
  const regular = roomRegularHours(iso);
  let className = "room-day-cell " + thaiWeekdayClass(iso) + (regular.dayLabel === "เสาร์–อาทิตย์" ? " is-weekend" : "") + (publicMode ? " public-mode" : "") + (iso === todayISO() ? " is-today" : "");
  let label = "";
  let icon = "";
  let detail = "";

  if (event) {
    className += " " + meta.className;
    const compactLabels = {
      closed:"ปิด",
      limited:"รับจำกัด",
      mobile_unit:"ออกหน่วย",
      activity:"กิจกรรม",
      open:"เปิด"
    };
    label = compactLabels[event.type] || meta.label;
    icon = '<i class="bi ' + meta.icon + '"></i>';
    detail = event.title || event.location || "";
  } else {
    className += " event-normal";
    label = "เปิด";
    icon = '<i class="bi bi-check-circle"></i>';
  }

  let hoursHtml = "";
  if (hours.show && hours.text) {
    const hourParts = String(hours.text).split("·").map(x => x.trim()).filter(Boolean);
    const lines = hourParts.map(x => '<span>' + escapeHtml(x) + '</span>').join('');
    hoursHtml = '<div class="room-day-hours"><i class="bi bi-clock"></i><span class="room-day-hours-lines">' + lines + '</span></div>';
  }

  const inner = '<div class="room-day-number">' + day + '</div><div class="room-day-state">' + icon + '<b>' + escapeHtml(label) + '</b></div>' + (detail ? '<div class="room-day-detail">' + escapeHtml(detail) + '</div>' : '') + hoursHtml;
  if (clickable) return '<button type="button" class="' + className + '" onclick="selectRoomAdminDate(\'' + iso + '\')">' + inner + '</button>';
  return '<div class="' + className + '">' + inner + '</div>';
}

function renderRoomCalendar(container, month, events, clickable, publicMode) {
  const range = monthRange(month);
  if (!container || !range) return;
  const eventMap = {};
  (events || []).forEach(e => eventMap[e.date] = e);
  const headers = [
    {label:"จ.",cls:"thai-day-mon"},{label:"อ.",cls:"thai-day-tue"},{label:"พ.",cls:"thai-day-wed"},
    {label:"พฤ.",cls:"thai-day-thu"},{label:"ศ.",cls:"thai-day-fri"},{label:"ส.",cls:"thai-day-sat"},{label:"อา.",cls:"thai-day-sun"}
  ];
  let html = (publicMode ? '<div class="room-calendar-mobile-note"><i class="bi bi-palette"></i> สีด้านบนใช้สีประจำวันแบบไทย · รายละเอียดวันพิเศษดูใต้ปฏิทิน</div>' : '') +
    '<div class="room-calendar-head">' + headers.map(h => '<div class="' + h.cls + '">' + h.label + '</div>').join('') + '</div><div class="room-calendar-days">';
  const offset = calendarMonthOffset(range);
  for (let i=0;i<offset;i++) html += '<div class="room-day-cell empty"></div>';
  for (let day=1; day<=range.days; day++) {
    const iso = month + "-" + pad2(day);
    html += roomCalendarCellHtml(day, iso, range, eventMap[iso], clickable, publicMode);
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderRoomHighlights(container, events) {
  if (!container) return;
  const visible = (events || []).filter(e => e.type !== "open" || e.title || e.note || e.location || e.time);
  if (!visible.length) {
    container.innerHTML = '<div class="public-calendar-message"><i class="bi bi-check-circle"></i><div><b>ไม่มีประกาศพิเศษในเดือนนี้</b><span>วันที่ไม่มีสถานะพิเศษถือว่าเปิดทำการตามปกติ</span></div></div>';
    return;
  }
  container.innerHTML = visible.map(e => {
    const meta = roomEventMeta(e.type);
    const parts = [];
    if (e.time) parts.push(e.time);
    if (e.location) parts.push(e.location);
    if (e.note) parts.push(e.note);
    return '<article class="room-highlight ' + meta.className + '"><div class="room-highlight-icon"><i class="bi ' + meta.icon + '"></i></div><div><span>' + escapeHtml(isoToThaiDate(e.date, true)) + '</span><b>' + escapeHtml(e.title || meta.label) + '</b><p>' + escapeHtml(parts.join(" · ") || meta.label) + '</p></div></article>';
  }).join('');
}

async function loadPublicRoomCalendar(allowAutoNext) {
  const monthInput = $("publicRoomMonth");
  const calendar = $("publicRoomCalendar");
  const status = $("publicRoomCalendarStatus");
  const highlights = $("publicRoomHighlights");
  if (!monthInput || !calendar) return;
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  if (status) status.innerText = "กำลังโหลดปฏิทิน...";
  calendar.innerHTML = "";
  if (highlights) highlights.innerHTML = "";

  const { data, error } = await sb.rpc("get_room_calendar", { p_month:month });
  if (error || !data || data.ok !== true) {
    if (status) status.innerText = "โหลดปฏิทินไม่สำเร็จ กรุณาลองใหม่";
    return;
  }

  if (!data.published) {
    if (allowAutoNext !== false && month === currentMonthValue()) {
      const next = nextMonthValue();
      const probe = await sb.rpc("get_room_calendar", { p_month:next });
      if (!probe.error && probe.data && probe.data.ok === true && probe.data.published) {
        monthInput.value = next;
        return loadPublicRoomCalendar(false);
      }
    }
    if (status) status.innerHTML = '<div class="public-calendar-message"><i class="bi bi-calendar2"></i><div><b>เดือนนี้ยังไม่มีประกาศ</b><span>กรุณาดูอีกครั้งหลังเจ้าหน้าที่เผยแพร่ตาราง</span></div></div>';
    return;
  }

  currentPublicRoomEvents = Array.isArray(data.events) ? data.events : [];
  if (status) {
    const versionText = Number(data.version || 0) > 0 ? 'v.' + Number(data.version) : '';
    const publishedText = data.publishedAt ? formatBangkokLogTime(data.publishedAt, true).replace(/:\d{2}(?=\s|$)/, '') : '';
    status.innerHTML = '<div class="published-banner"><i class="bi bi-check2-circle"></i><span><b>' + escapeHtml(thaiMonthLabel(month)) + '</b> · ตารางที่เผยแพร่แล้ว' +
      ((versionText || publishedText) ? '<small class="calendar-version-badge">' + escapeHtml([versionText, publishedText ? 'ประกาศ ' + publishedText : ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></div>';
  }
  renderRoomCalendar(calendar, month, currentPublicRoomEvents, false, true);
  renderRoomHighlights(highlights, currentPublicRoomEvents);
}

async function prepareRoomCalendarMonth() {
  const month = $("roomAdminMonth")?.value;
  const box = $("roomAdminResult");
  if (!month) { setStaffResult(box, "กรุณาเลือกเดือน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("prepare_room_calendar_month", { p_month:month });
  if (error || !data || data.ok !== true) setStaffResult(box, "เตรียมเดือนไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, "เตรียมปฏิทิน " + thaiMonthLabel(month) + " แล้ว\nทุกวันตั้งต้นเป็นเปิดตามเวลาปกติของวันในสัปดาห์ ให้เพิ่มเฉพาะวันที่ปิด รับจำกัด ออกหน่วย มีกิจกรรม หรือใช้เวลาพิเศษ", true);
  await loadRoomCalendarAdmin();
}

async function publishRoomCalendarMonth(published) {
  const month = $("roomAdminMonth")?.value;
  const box = $("roomAdminResult");
  if (!month) { setStaffResult(box, "กรุณาเลือกเดือน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("set_room_calendar_month_published", { p_month:month, p_published:!!published });
  if (error || !data || data.ok !== true) setStaffResult(box, (published ? "เผยแพร่" : "ซ่อนประกาศ") + "ไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, published ? "เผยแพร่ปฏิทินให้ผู้บริจาคเห็นแล้ว" : "ซ่อนปฏิทินเดือนนี้จากหน้าสาธารณะแล้ว", true);
  await loadRoomCalendarAdmin();
}

function applyRoomEventTypeDefaults() {
  const type = $("roomEventType")?.value || "closed";
  const title = $("roomEventTitle");
  if (!title || title.value.trim()) return;
  const meta = roomEventMeta(type);
  title.value = meta.label;
}

async function saveRoomCalendarEvent() {
  const date = $("roomEventDate")?.value;
  const type = $("roomEventType")?.value || "closed";
  const title = $("roomEventTitle")?.value.trim() || "";
  const note = $("roomEventNote")?.value.trim() || "";
  const location = $("roomEventLocation")?.value.trim() || "";
  const timeText = $("roomEventTime")?.value.trim() || "";
  const box = $("roomAdminResult");
  if (!date) { setStaffResult(box, "กรุณาเลือกวันที่", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("upsert_room_calendar_event", {
    p_event_date:date,
    p_event_type:type,
    p_title:title,
    p_public_note:note,
    p_location:location,
    p_time_text:timeText,
    p_is_public:true
  });
  if (error || !data || data.ok !== true) setStaffResult(box, "บันทึกไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else setStaffResult(box, "บันทึกสถานะวันที่ " + isoToThaiDate(date, true) + " แล้ว", true);
  await loadRoomCalendarAdmin();
}

async function deleteRoomCalendarEvent() {
  const date = $("roomEventDate")?.value;
  const box = $("roomAdminResult");
  if (!date) { setStaffResult(box, "กรุณาเลือกวันที่ก่อน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("delete_room_calendar_event", { p_event_date:date });
  if (error || !data || data.ok !== true) setStaffResult(box, "ลบไม่สำเร็จ\n" + (error?.message || data?.message || ""), false);
  else {
    setStaffResult(box, "ลบสถานะพิเศษของวันที่นี้แล้ว ระบบจะกลับเป็น “เปิดตามปกติ”", true);
    ["roomEventTitle","roomEventNote","roomEventLocation","roomEventTime"].forEach(id => { if ($(id)) $(id).value = ""; });
  }
  await loadRoomCalendarAdmin();
}

function selectRoomAdminDate(value) {
  if ($("roomEventDate")) $("roomEventDate").value = value;
  const event = currentRoomAdminEvents.find(e => e.date === value);
  if ($("roomEventType")) $("roomEventType").value = event?.type || "closed";
  if ($("roomEventTitle")) $("roomEventTitle").value = event?.title || "";
  if ($("roomEventNote")) $("roomEventNote").value = event?.note || "";
  if ($("roomEventLocation")) $("roomEventLocation").value = event?.location || "";
  if ($("roomEventTime")) $("roomEventTime").value = event?.time || "";
  const form = $("roomEventDate");
  if (form && form.scrollIntoView) form.scrollIntoView({ behavior:"smooth", block:"center" });
}

function buildRoomAnnouncement(month, events) {
  const sorted = [...(events || [])].sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const lines = [];
  lines.push("📅 ตารางห้องบริจาคโลหิต ประจำเดือน " + thaiMonthLabel(month));
  if (currentRoomAdminVersion > 0) {
    const publishedText = currentRoomAdminPublishedAt ? formatBangkokLogTime(currentRoomAdminPublishedAt, true).replace(/:\d{2}(?=\s|$)/, '') : "";
    lines.push("ฉบับ v." + currentRoomAdminVersion + (publishedText ? " · ประกาศ " + publishedText : ""));
  }
  lines.push("");
  lines.push("เวลารับลงทะเบียนปกติ");
  lines.push("• จันทร์–ศุกร์ 08:30–11:30 น. และ 13:00–15:30 น.");
  lines.push("• เสาร์–อาทิตย์ 09:30–11:30 น. และ 13:00–16:30 น.");
  lines.push("• พักเที่ยง 12:00–13:00 น.");
  lines.push("");
  lines.push("วันที่ไม่มีประกาศพิเศษ: เปิดตามเวลาปกติด้านบน");
  if (!sorted.length) {
    lines.push("เดือนนี้ไม่มีประกาศเปลี่ยนแปลงเพิ่มเติม");
  } else {
    lines.push("");
    sorted.forEach(e => {
      const meta = roomEventMeta(e.type);
      const details = [];
      if (e.title && e.title !== meta.label) details.push(e.title);
      if (e.time) details.push(e.time);
      if (e.location) details.push("สถานที่ " + e.location);
      if (e.note) details.push(e.note);
      lines.push("• " + isoToThaiDate(e.date, true) + " — " + meta.label + (details.length ? " · " + details.join(" · ") : ""));
    });
  }
  lines.push("");
  lines.push("ดูปฏิทินล่าสุด: " + routeUrl("roomCalendar"));
  lines.push("สอบถามเพิ่มเติม โทร. " + (CONFIG.PHONE_TEXT || "02-839-6050") + " ในวันและเวลาทำการครับ");
  return lines.join("\n");
}

async function loadRoomCalendarAdmin() {
  const monthInput = $("roomAdminMonth");
  const calendar = $("roomAdminCalendar");
  if (!monthInput || !calendar) return;
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const isStaff = await ensureStaff(false); if (!isStaff) return;
  calendar.innerHTML = '<div class="staff-result">กำลังโหลดปฏิทิน...</div>';

  const { data, error } = await sb.rpc("get_room_calendar", { p_month:month });
  if (error || !data || data.ok !== true) {
    calendar.innerHTML = '<div class="staff-result fail">โหลดปฏิทินไม่สำเร็จ<br>' + escapeHtml(error?.message || data?.message || "") + '</div>';
    return;
  }

  currentRoomAdminEvents = Array.isArray(data.events) ? data.events : [];
  currentRoomAdminVersion = Number(data.version || 0);
  currentRoomAdminPublishedAt = data.publishedAt || null;
  if ($("roomAdminMonthStatus")) {
    const v = Number(data.version || 0);
    $("roomAdminMonthStatus").innerText = data.published ? ("เผยแพร่แล้ว" + (v ? " · v." + v : "")) : "ฉบับร่าง · ผู้บริจาคยังไม่เห็น";
    $("roomAdminMonthStatus").className = data.published ? "published" : "draft";
  }
  if ($("roomAdminMonthHint")) {
    if (data.published) {
      const publishedAt = data.publishedAt ? formatBangkokLogTime(data.publishedAt, true).replace(/:\d{2}(?=\s|$)/, '') : "";
      $("roomAdminMonthHint").innerText = publishedAt ? ("ประกาศล่าสุด " + publishedAt + " · แก้ข้อมูลหลังเผยแพร่ ระบบจะขยับ revision ให้อัตโนมัติ") : "ผู้บริจาคเห็นข้อมูลชุดนี้แล้ว";
    } else {
      $("roomAdminMonthHint").innerText = "ตั้งเดือนไว้ล่วงหน้าได้ตั้งแต่เดือนปัจจุบันเป็นต้นไป · ตรวจวันหยุดให้ครบแล้วค่อยเผยแพร่";
    }
  }

  renderRoomCalendar(calendar, month, currentRoomAdminEvents, true, false);
  if ($("roomAnnouncementText")) $("roomAnnouncementText").innerText = buildRoomAnnouncement(month, currentRoomAdminEvents);

  const r = monthRange(month);
  const today = todayISO();
  if (r && $("roomEventDate")) {
    $("roomEventDate").min = r.start > today ? r.start : r.start;
    $("roomEventDate").max = r.end;
  }
}

async function copyRoomAnnouncement() {
  const text = $("roomAnnouncementText")?.innerText || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showModal({ title:"คัดลอกแล้ว", message:"นำข้อความไปวางใน Facebook, LINE OA หรือ Instagram ได้เลย", iconText:"✓", type:"success" });
  } catch (err) {
    showModal({ title:"คัดลอกอัตโนมัติไม่ได้", message:"กรุณาเลือกข้อความในกล่องแล้วคัดลอกด้วยตนเอง", iconText:"!" });
  }
}

function posterRoundRect(ctx, x, y, w, h, radius, fill, stroke) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function posterWrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return y;
  let line = "";
  let lineCount = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      lineCount++;
      line = words[i];
      if (maxLines && lineCount >= maxLines - 1) {
        const rest = [line].concat(words.slice(i + 1)).join(" ");
        let clipped = rest;
        while (clipped.length > 1 && ctx.measureText(clipped + "…").width > maxWidth) clipped = clipped.slice(0, -1);
        ctx.fillText(clipped + (clipped !== rest ? "…" : ""), x, y);
        return y + lineHeight;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

function posterEventStyle(type) {
  const map = {
    closed: { fill:"#fff0f1", stroke:"#edc9cc", text:"#a9363e", short:"ปิด" },
    limited: { fill:"#fff7e6", stroke:"#efdcae", text:"#98661a", short:"รับจำกัด" },
    mobile_unit: { fill:"#edf6fb", stroke:"#cbdfea", text:"#336f8d", short:"ออกหน่วย" },
    activity: { fill:"#f5f0fa", stroke:"#ddd1e8", text:"#715492", short:"กิจกรรม" },
    open: { fill:"#edf8f1", stroke:"#cbe5d5", text:"#287651", short:"เปิด" }
  };
  return map[type] || map.activity;
}

async function downloadRoomCalendarPoster() {
  const month = $("roomAdminMonth")?.value || currentMonthValue();
  const range = monthRange(month);
  if (!range) {
    showModal({ title:"ยังสร้างภาพไม่ได้", message:"กรุณาเลือกเดือนก่อน", iconText:"!" });
    return;
  }

  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    const events = [...(currentRoomAdminEvents || [])].sort((a,b) => String(a.date).localeCompare(String(b.date)));
    const eventMap = {};
    events.forEach(e => eventMap[e.date] = e);

    ctx.fillStyle = "#f8f5f4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header
    posterRoundRect(ctx, 46, 46, 988, 190, 34, "#fffafb", "#efdfe0");
    ctx.fillStyle = "#c94149";
    ctx.font = '800 56px "Noto Sans Thai", sans-serif';
    ctx.fillText("CNMI Blood Donation", 92, 116);
    ctx.fillStyle = "#1f2933";
    ctx.font = '800 48px "Noto Sans Thai", sans-serif';
    ctx.fillText("ตารางห้องบริจาคโลหิต", 92, 174);
    ctx.fillStyle = "#69757c";
    ctx.font = '600 28px "Noto Sans Thai", sans-serif';
    ctx.fillText(thaiMonthLabel(month), 92, 215);
    if (currentRoomAdminVersion > 0) {
      const revText = "v." + currentRoomAdminVersion;
      const publishedText = currentRoomAdminPublishedAt ? formatBangkokLogTime(currentRoomAdminPublishedAt, true).replace(/:\d{2}(?=\s|$)/, '') : "";
      ctx.textAlign = "right";
      ctx.fillStyle = "#8b7376";
      ctx.font = '600 20px "Noto Sans Thai", sans-serif';
      ctx.fillText(revText + (publishedText ? " · " + publishedText : ""), 994, 211);
      ctx.textAlign = "left";
    }

    // Calendar frame
    const calX = 46, calY = 270, calW = 988;
    const gap = 8;
    const colW = (calW - gap * 6) / 7;
    const headerH = 48;
    const cellH = 112;
    const headers = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์","อาทิตย์"];
    ctx.font = '700 22px "Noto Sans Thai", sans-serif';
    ctx.textAlign = "center";
    headers.forEach((h, idx) => {
      const x = calX + idx * (colW + gap);
      posterRoundRect(ctx, x, calY, colW, headerH, 14, idx >= 5 ? "#f0eeee" : "#f3e7e8", null);
      ctx.fillStyle = idx >= 5 ? "#747b7f" : "#9c3a40";
      ctx.fillText(h, x + colW / 2, calY + 31);
    });

    const offset = calendarMonthOffset(range);
    const rows = Math.ceil((offset + range.days) / 7);
    const startY = calY + headerH + 10;
    ctx.textAlign = "left";

    for (let i = 0; i < rows * 7; i++) {
      const day = i - offset + 1;
      const col = i % 7;
      const row = Math.floor(i / 7);
      const x = calX + col * (colW + gap);
      const y = startY + row * (cellH + gap);
      if (day < 1 || day > range.days) {
        posterRoundRect(ctx, x, y, colW, cellH, 16, "#f5f3f2", null);
        continue;
      }

      const iso = month + "-" + pad2(day);
      const dt = new Date(range.year, range.month - 1, day, 12);
      const event = eventMap[iso];
      let fill = "#ffffff";
      let stroke = "#e6e1df";
      let statusColor = "#43805f";
      let statusText = "เปิด";
      let detail = "ปกติ";

      if (event) {
        const st = posterEventStyle(event.type);
        fill = st.fill; stroke = st.stroke; statusColor = st.text; statusText = st.short;
        detail = event.title || event.location || event.time || "";
      }

      posterRoundRect(ctx, x, y, colW, cellH, 16, fill, stroke);
      ctx.fillStyle = "#505d63";
      ctx.font = '800 26px "Noto Sans Thai", sans-serif';
      ctx.fillText(String(day), x + 12, y + 31);

      ctx.fillStyle = statusColor;
      ctx.font = '800 22px "Noto Sans Thai", sans-serif';
      ctx.fillText(statusText, x + 12, y + 61);

      ctx.fillStyle = "#758087";
      ctx.font = '500 16px "Noto Sans Thai", sans-serif';
      const short = String(detail || "").slice(0, 25);
      posterWrapText(ctx, short, x + 12, y + 86, colW - 24, 18, 2);
    }

    // Highlights / footer
    const highY = startY + rows * (cellH + gap) + 24;
    ctx.fillStyle = "#1f2933";
    ctx.font = '800 28px "Noto Sans Thai", sans-serif';
    ctx.fillText("ประกาศพิเศษ", 62, highY);
    let y = highY + 38;
    const special = events.filter(e => e.type !== "open" || e.title || e.note || e.location || e.time);
    ctx.font = '600 21px "Noto Sans Thai", sans-serif';
    if (!special.length) {
      ctx.fillStyle = "#68757c";
      ctx.fillText("เดือนนี้ไม่มีประกาศเปลี่ยนแปลงเพิ่มเติม", 62, y);
      y += 32;
    } else {
      special.slice(0, 3).forEach(e => {
        const meta = roomEventMeta(e.type);
        const bits = [e.title || meta.label, e.time, e.location].filter(Boolean);
        ctx.fillStyle = "#4d5960";
        y = posterWrapText(ctx, "• " + isoToThaiDate(e.date, true) + " — " + bits.join(" · "), 62, y, 956, 28, 1);
        y += 3;
      });
      if (special.length > 3) {
        ctx.fillStyle = "#7a858b";
        ctx.fillText("ดูรายละเอียดเพิ่มเติมที่ donor.cnmiblood.com/#/calendar", 62, y);
        y += 30;
      }
    }

    ctx.fillStyle = "#69757c";
    ctx.font = '600 20px "Noto Sans Thai", sans-serif';
    ctx.fillText("วันที่ไม่มีสถานะพิเศษถือว่าเปิดทำการตามปกติ", 62, 1288);
    ctx.fillStyle = "#c94149";
    ctx.font = '800 22px "Noto Sans Thai", sans-serif';
    ctx.fillText("สอบถาม " + (CONFIG.PHONE_TEXT || "02-839-6050") + "  •  donor.cnmiblood.com/#/calendar", 62, 1322);

    const link = document.createElement("a");
    link.download = "CNMI-Donor-Calendar-" + month + ".png";
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();

    showModal({ title:"สร้างภาพประกาศแล้ว", message:"ได้ภาพแนวตั้งสำหรับนำไปโพสต์ต่อใน Facebook, LINE OA หรือ Instagram ได้เลย", iconText:"✓", type:"success" });
  } catch (err) {
    showModal({ title:"สร้างภาพไม่สำเร็จ", message:"กรุณาลองใหม่อีกครั้ง หรือใช้ปุ่มคัดลอกข้อความแทน", iconText:"!" });
  }
}


async function loadStaffMobileUnitRequests() {
  const box = $("staffMobileUnitRequestsResult"); if (!box) return;
  const from = $("mobileUnitListFrom")?.value || todayISO();
  if ($("mobileUnitListFrom") && !$("mobileUnitListFrom").value) $("mobileUnitListFrom").value = from;
  const isStaff = await ensureStaff(false); if (!isStaff) return;

  box.innerHTML = '<div class="staff-result">กำลังโหลดคำขอออกหน่วย...</div>';
  const { data, error } = await sb.from("mobile_unit_requests")
    .select("request_id,organization_name,estimated_people,preferred_date,coordinator_name,phone,email,location_text,note,status,created_at")
    .gte("preferred_date", from)
    .order("preferred_date", { ascending:true })
    .order("created_at", { ascending:true })
    .limit(200);

  if (error) {
    box.innerHTML = '<div class="staff-result fail">โหลดคำขอไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>';
    return;
  }

  if (!Array.isArray(data) || !data.length) {
    box.innerHTML = '<div class="staff-result">ไม่พบคำขอออกหน่วยตั้งแต่วันที่เลือก</div>';
    return;
  }

  let html = '<table class="table preview-table align-middle"><thead><tr><th>วันที่ต้องการ</th><th>หน่วยงาน</th><th>จำนวน</th><th>สถานที่</th><th>ผู้ประสานงาน</th><th>ติดต่อ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>';
  data.forEach(r => {
    const idArg = JSON.stringify(r.request_id || "");
    const phone = String(r.phone || "");
    const note = r.note ? '<small class="d-block text-muted mt-1">' + escapeHtml(r.note) + '</small>' : '';
    html += '<tr>' +
      '<td data-label="วันที่">' + escapeHtml(isoToThaiDate(r.preferred_date, true)) + '<small class="d-block text-muted">' + escapeHtml(r.request_id || "") + '</small></td>' +
      '<td data-label="หน่วยงาน"><b>' + escapeHtml(r.organization_name || "") + '</b>' + note + '</td>' +
      '<td data-label="จำนวน">' + escapeHtml(String(r.estimated_people || 0)) + ' คน</td>' +
      '<td data-label="สถานที่">' + escapeHtml(r.location_text || "") + '</td>' +
      '<td data-label="ผู้ประสานงาน">' + escapeHtml(r.coordinator_name || "") + '</td>' +
      '<td data-label="ติดต่อ"><a href="tel:' + escapeHtml(phone) + '">' + escapeHtml(phone) + '</a>' + (r.email ? '<br><a class="mail-link-btn" href="' + escapeHtml(buildMailtoHref(r.email, 'CNMI Blood Donation — ประสานงานออกหน่วย', 'เรียน ' + (r.coordinator_name || '') + '\n\nเกี่ยวกับคำขอออกหน่วยของ ' + (r.organization_name || '') + '\nวันที่ที่ต้องการ ' + isoToThaiDate(r.preferred_date, true) + '\n\nห้องบริจาคโลหิต CNMI')) + '"><i class="bi bi-envelope"></i> ' + escapeHtml(r.email) + '</a>' : '') + '</td>' +
      '<td data-label="สถานะ"><span class="booking-status-pill">' + escapeHtml(r.status || "") + '</span></td>' +
      '<td data-label="จัดการ"><div class="table-action-stack">' +
        "<button type=\"button\" class=\"btn btn-soft btn-sm\" onclick='staffSetMobileUnitRequestStatus(" + idArg + ",\"กำลังประสาน\")'>กำลังประสาน</button>" +
        "<button type=\"button\" class=\"btn btn-soft btn-sm\" onclick='staffSetMobileUnitRequestStatus(" + idArg + ",\"ยืนยันแล้ว\")'>ยืนยันแล้ว</button>" +
        "<button type=\"button\" class=\"btn btn-outline-danger btn-sm\" onclick='staffSetMobileUnitRequestStatus(" + idArg + ",\"ไม่รับ\")'>ไม่รับ</button>" +
      '</div></td>' +
    '</tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}

async function staffSetMobileUnitRequestStatus(requestId, status) {
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("staff_set_mobile_unit_request_status", {
    p_request_id: requestId,
    p_status: status
  });
  if (error || !data || data.ok !== true) {
    showModal({ title:"อัปเดตไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  syncStaffPlannerEvent("mobile", requestId, "status");
  await loadStaffMobileUnitRequests();
}

async function loadStaffGroupRequests() {
  const box = $("staffGroupRequestsResult"); if (!box) return;
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const from = $("groupListFrom")?.value || todayISO();
  if ($("groupListFrom") && !$("groupListFrom").value) $("groupListFrom").value = from;
  box.innerHTML = '<div class="staff-result">กำลังโหลด...</div>';
  const { data, error } = await sb.from("group_booking_requests")
    .select("request_id,group_name,coordinator_name,phone,email,requested_date,estimated_people,status,note,created_at")
    .gte("requested_date", from)
    .order("requested_date", { ascending:true })
    .order("created_at", { ascending:true });
  if (error) { box.innerHTML = '<div class="staff-result fail">โหลดไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>'; return; }
  if (!data || data.length === 0) { box.innerHTML = '<div class="staff-result">ยังไม่มีคำขอหมู่คณะตั้งแต่วันที่เลือก</div>'; return; }
  box.innerHTML = '<table class="table table-sm preview-table mobile-card-table"><thead><tr><th>วันที่</th><th>กลุ่ม</th><th>จำนวน</th><th>ผู้ประสาน</th><th>ติดต่อ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>' + data.map(r => {
    const safeId=String(r.request_id || "").replace(/'/g, "\\'");
    return '<tr>' +
      '<td data-label="วันที่">' + escapeHtml(isoToDDMMYYYY(r.requested_date)) + '</td>' +
      '<td data-label="กลุ่ม"><b>' + escapeHtml(r.group_name) + '</b>' + (r.note ? '<br><small>' + escapeHtml(r.note) + '</small>' : '') + '</td>' +
      '<td data-label="จำนวน">' + escapeHtml(r.estimated_people) + ' คน</td>' +
      '<td data-label="ผู้ประสาน">' + escapeHtml(r.coordinator_name) + '</td>' +
      '<td data-label="ติดต่อ"><a href="tel:' + escapeHtml(r.phone) + '">' + escapeHtml(r.phone) + '</a>' + (r.email ? '<br><a class="mail-link-btn" href="' + escapeHtml(buildMailtoHref(r.email, 'CNMI Blood Donation — นัดบริจาคเป็นหมู่คณะ', 'เรียน ' + (r.coordinator_name || '') + '\n\nเกี่ยวกับคำขอบริจาคเป็นหมู่คณะของ ' + (r.group_name || '') + '\nวันที่ที่ต้องการ ' + isoToThaiDate(r.requested_date, true) + '\n\nห้องบริจาคโลหิต CNMI')) + '"><i class="bi bi-envelope"></i> ' + escapeHtml(r.email) + '</a>' : '') + '</td>' +
      '<td data-label="สถานะ">' + escapeHtml(r.status) + '</td>' +
      '<td data-label="จัดการ"><select class="form-select form-select-sm" onchange="staffSetGroupRequestStatus(\'' + safeId + '\',this.value)"><option value="">เปลี่ยนสถานะ</option><option value="รอติดต่อ">รอติดต่อ</option><option value="ยืนยันแล้ว">ยืนยันแล้ว</option><option value="ต้องติดต่อ">ต้องติดต่อ</option><option value="ไม่รับ">ไม่รับ</option><option value="ยกเลิก">ยกเลิก</option></select></td>' +
      '</tr>';
  }).join('') + '</tbody></table>';
}

async function staffSetGroupRequestStatus(requestId, status) {
  if (!status) return;
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("staff_set_group_request_status", { p_request_id:requestId, p_status:status });
  if (error || !data || data.ok !== true) {
    showModal({ title:"บันทึกไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  syncStaffPlannerEvent("group", requestId, "status");
  await loadStaffGroupRequests();
}

function updateStaffNotificationBadge(count) {
  const badge = $("staffNotificationBadge");
  if (!badge) return;
  const n = Number(count || 0);
  badge.innerText = n > 99 ? "99+" : String(n);
  badge.style.display = n > 0 ? "inline-flex" : "none";
}

function notificationTypeMeta(type) {
  const map = {
    platelet:{ label:"คิวเกล็ดเลือด", icon:"bi-droplet-half", cls:"type-platelet" },
    group:{ label:"หมู่คณะเลือดแดง", icon:"bi-people", cls:"type-group" },
    mobile:{ label:"ออกหน่วยนอกสถานที่", icon:"bi-truck", cls:"type-mobile" },
    calendar:{ label:"ปฏิทินห้อง", icon:"bi-calendar-event", cls:"type-calendar" }
  };
  return map[type] || { label:"แจ้งเตือน", icon:"bi-bell", cls:"type-default" };
}

async function refreshStaffNotificationBadge() {
  if (!currentStaffProfile) return;
  try {
    const count = await getExactCount(sb.from("staff_notifications").select("id", { count:"exact", head:true }).eq("is_read", false));
    updateStaffNotificationBadge(count);
  } catch (err) {}
}

async function openNotificationTarget(type, sourceId) {
  if (type === "platelet") {
    let bookingDate = todayISO();
    if (sourceId) {
      try {
        const { data } = await sb.from("bookings").select("booking_date").eq("booking_id", sourceId).maybeSingle();
        if (data?.booking_date) bookingDate = data.booking_date;
      } catch (_) {}
    }
    if ($("bookingListDate")) $("bookingListDate").value = bookingDate;
    showStaffTab("bookings");
  } else if (type === "group") showStaffTab("groups");
  else if (type === "mobile") showStaffTab("mobileUnits");
  else if (type === "calendar") showStaffTab("roomCalendar");
}

async function markStaffNotificationRead(id) {
  const ok = await ensureStaff(false); if (!ok) return;
  await sb.rpc("mark_staff_notification_read", { p_notification_id:id });
  await refreshStaffNotificationBadge();
  await loadStaffNotifications();
}

async function viewStaffNotificationDetails(type, sourceId) {
  const ok = await ensureStaff(false); if (!ok) return;
  let title = "รายละเอียดรายการ";
  let lines = [];
  try {
    if (type === "platelet") {
      const { data, error } = await sb.from("bookings")
        .select("booking_id,public_code,full_name,phone,email,donor_id,booking_date,time_slot,status,note")
        .eq("booking_id", sourceId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("ไม่พบรายการจองนี้");
      title = "รายละเอียดคิวบริจาคเกล็ดเลือด";
      lines = [
        "ชื่อ: " + (data.full_name || "-"),
        "วันที่: " + isoToThaiDate(data.booking_date, true),
        "เวลา: " + String(data.time_slot || "").slice(0,5) + " น.",
        "เลขนัด: " + (data.public_code || data.booking_id || "-"),
        "โทร: " + (data.phone || "-"),
        "อีเมล: " + (data.email || "-"),
        "Donor ID: " + (data.donor_id || "-"),
        "สถานะ: " + (data.status || "-"),
        data.note ? "หมายเหตุ: " + data.note : ""
      ].filter(Boolean);
    } else if (type === "group") {
      const { data, error } = await sb.from("group_booking_requests")
        .select("request_id,group_name,coordinator_name,phone,email,requested_date,estimated_people,status,note")
        .eq("request_id", sourceId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("ไม่พบคำขอนี้");
      title = "รายละเอียดคำขอหมู่คณะเลือดแดง";
      lines = [
        "หน่วยงาน/กลุ่ม: " + (data.group_name || "-"),
        "วันที่ต้องการ: " + isoToThaiDate(data.requested_date, true),
        "จำนวนโดยประมาณ: " + (data.estimated_people || 0) + " คน",
        "ผู้ประสานงาน: " + (data.coordinator_name || "-"),
        "โทร: " + (data.phone || "-"),
        "อีเมล: " + (data.email || "-"),
        "สถานะ: " + (data.status || "-"),
        data.note ? "หมายเหตุ: " + data.note : ""
      ].filter(Boolean);
    } else if (type === "mobile") {
      const { data, error } = await sb.from("mobile_unit_requests")
        .select("request_id,organization_name,coordinator_name,phone,email,preferred_date,estimated_people,location_text,status,note")
        .eq("request_id", sourceId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("ไม่พบคำขอนี้");
      title = "รายละเอียดคำขอออกหน่วยนอกสถานที่";
      lines = [
        "หน่วยงาน/ชุมชน: " + (data.organization_name || "-"),
        "วันที่ต้องการ: " + isoToThaiDate(data.preferred_date, true),
        "จำนวนโดยประมาณ: " + (data.estimated_people || 0) + " คน",
        "สถานที่: " + (data.location_text || "-"),
        "ผู้ประสานงาน: " + (data.coordinator_name || "-"),
        "โทร: " + (data.phone || "-"),
        "อีเมล: " + (data.email || "-"),
        "สถานะ: " + (data.status || "-"),
        data.note ? "หมายเหตุ: " + data.note : ""
      ].filter(Boolean);
    }
  } catch (err) {
    showModal({ title:"เปิดรายละเอียดไม่สำเร็จ", message:err?.message || String(err), iconText:"!" });
    return;
  }
  showModal({
    title,
    message: lines.join("\n"),
    iconText:"i",
    primaryText:"ไปหน้าจัดการ",
    secondaryText:"ปิด",
    onPrimary:() => openNotificationTarget(type, sourceId)
  });
}

async function markAllStaffNotificationsRead() {
  const ok = await ensureStaff(true); if (!ok) return;
  const { data, error } = await sb.rpc("mark_all_staff_notifications_read");
  if (error || !data || data.ok !== true) {
    showModal({ title:"บันทึกไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  await loadStaffNotifications();
  await refreshStaffNotificationBadge();
}

async function loadStaffNotifications() {
  const box = $("staffNotificationsResult"); if (!box) return;
  const ok = await ensureStaff(false); if (!ok) return;
  const filter = $("notificationFilter")?.value || "unread";
  box.innerHTML = '<div class="staff-result">กำลังโหลดแจ้งเตือน...</div>';
  let query = sb.from("staff_notifications")
    .select("id,source_type,source_id,event_type,title,message,target_date,is_read,created_at")
    .order("created_at", { ascending:false })
    .limit(100);
  if (filter === "unread") query = query.eq("is_read", false);
  else if (["platelet","group","mobile"].includes(filter)) query = query.eq("source_type", filter);
  const { data, error } = await query;
  if (error) { box.innerHTML = '<div class="staff-result fail">โหลดแจ้งเตือนไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>'; return; }
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) { box.innerHTML = '<div class="notification-empty"><i class="bi bi-check2-circle"></i><b>ไม่มีรายการในตัวกรองนี้</b><span>รายการใหม่จากทั้ง 3 บริการจะมาแสดงตรงนี้</span></div>'; await refreshStaffNotificationBadge(); return; }
  box.innerHTML = rows.map(r => {
    const meta = notificationTypeMeta(r.source_type);
    const idArg = JSON.stringify(r.id || "");
    const typeArg = JSON.stringify(r.source_type || "");
    const sourceArg = JSON.stringify(r.source_id || "");
    return '<article class="notification-item ' + meta.cls + (r.is_read ? ' is-read' : ' is-unread') + '">' +
      '<div class="notification-item-icon"><i class="bi ' + meta.icon + '"></i></div>' +
      '<div class="notification-item-copy"><div class="notification-item-top"><span>' + escapeHtml(meta.label) + '</span><time>' + escapeHtml(formatBangkokLogTime(r.created_at, true)) + '</time></div><b>' + escapeHtml(r.title || meta.label) + '</b><p>' + escapeHtml(r.message || '') + '</p>' + (r.target_date ? '<small><i class="bi bi-calendar3"></i> ' + escapeHtml(isoToThaiDate(r.target_date, true)) + '</small>' : '') + '</div>' +
      '<div class="notification-item-actions">' + (!r.is_read ? '<button type="button" class="btn btn-soft btn-sm" onclick=\'markStaffNotificationRead(' + idArg + ')\'>อ่านแล้ว</button>' : '') + '<button type="button" class="btn btn-search btn-sm" onclick=\'viewStaffNotificationDetails(' + typeArg + ',' + sourceArg + ')\'>ดูรายละเอียด</button></div>' +
    '</article>';
  }).join('');
  await refreshStaffNotificationBadge();
}

function donorQuestionCategoryLabel(category) {
  const map = {
    eligibility:"คุณสมบัติ / ยา / วัคซีน / เพิ่งป่วย",
    post_donation:"อาการผิดปกติหลังบริจาค",
    test_result:"ผลตรวจ / ได้รับแจ้งให้ติดต่อ",
    other:"เรื่องอื่น ๆ"
  };
  return map[category] || "คำถามผู้บริจาค";
}

function donorQuestionCategoryIcon(category) {
  const map = { eligibility:"bi-capsule", post_donation:"bi-heart-pulse-fill", test_result:"bi-file-medical", other:"bi-chat-square-text" };
  return map[category] || "bi-chat-dots";
}

function donorChatReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) { return fallback; }
}

function donorChatWriteJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

function donorChatInitialGreetingHtml() {
  return '<div class="chat-row bot"><div class="chat-avatar-mini"><i class="bi bi-droplet-fill"></i></div><div class="chat-bubble"><b>พิมพ์คำถามได้เลยค่ะ</b><span>เรื่องที่ตอบได้ ระบบจะช่วยตอบให้ทันที หากต้องให้เจ้าหน้าที่ช่วยดู เราจะส่งต่อให้ค่ะ</span></div></div>';
}

function donorChatPersistDraft() {
  if (donorChatRestoringLocalDraft || currentDonorChatAccessToken || currentDonorChatPublicCode) return;
  const hasContent = donorChatLocalTranscript.length || donorChatIntakeState || donorChatPendingEscalationMessage;
  try {
    if (!hasContent) { localStorage.removeItem(DONOR_CHAT_STORAGE.draft); return; }
  } catch (e) {}
  donorChatWriteJson(DONOR_CHAT_STORAGE.draft, {
    version:1,
    updatedAt:new Date().toISOString(),
    transcript:donorChatLocalTranscript.slice(-80),
    intake:donorChatIntakeState || null,
    pendingMessage:donorChatPendingEscalationMessage || ""
  });
}

function donorChatClearDraft() {
  donorChatLocalTranscript = [];
  donorChatPendingEscalationMessage = "";
  try { localStorage.removeItem(DONOR_CHAT_STORAGE.draft); } catch (e) {}
}

function appendDonorChatBubble(role, content, isHtml, options) {
  options = options || {};
  const box = $("donorChatMessages");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "chat-row " + (role === "user" ? "user" : "bot");
  if (role !== "user") row.innerHTML = '<div class="chat-avatar-mini"><i class="bi bi-droplet-fill"></i></div><div class="chat-bubble"></div>';
  else row.innerHTML = '<div class="chat-bubble"></div>';
  const bubble = row.querySelector('.chat-bubble');
  if (isHtml) bubble.innerHTML = String(content || "");
  else bubble.textContent = String(content || "");
  box.appendChild(row);
  if (!options.skipPersist && !donorChatRestoringLocalDraft && !currentDonorChatAccessToken && !currentDonorChatPublicCode) {
    donorChatLocalTranscript.push({ role:role === "user" ? "user" : "bot", content:String(content || ""), isHtml:!!isHtml });
    donorChatPersistDraft();
  }
  if (!options.noScroll) setTimeout(function(){ row.scrollIntoView({ behavior:"smooth", block:"nearest" }); }, 20);
}

function restoreDonorChatLocalDraft() {
  const saved = donorChatReadJson(DONOR_CHAT_STORAGE.draft, null);
  if (!saved || !Array.isArray(saved.transcript) || (!saved.transcript.length && !saved.intake)) return false;
  const box = $("donorChatMessages");
  if (!box) return false;
  donorChatRestoringLocalDraft = true;
  try {
    box.innerHTML = donorChatInitialGreetingHtml();
    donorChatLocalTranscript = saved.transcript.slice(-80);
    donorChatPendingEscalationMessage = String(saved.pendingMessage || "");
    donorChatLocalTranscript.forEach(function(item){
      appendDonorChatBubble(item?.role === "user" ? "user" : "bot", item?.content || "", !!item?.isHtml, { skipPersist:true, noScroll:true });
    });
    donorChatIntakeState = saved.intake && typeof saved.intake === "object" ? saved.intake : null;
    if (donorChatIntakeState) {
      donorChatSetTopicChoicesVisible(false);
      if ($("donorChatSmartComposer")) $("donorChatSmartComposer").style.display = "none";
      if ($("donorChatThreadComposer")) $("donorChatThreadComposer").style.display = "none";
      donorChatRenderStep();
    } else {
      donorChatSetTopicChoicesVisible(true);
      if ($("donorChatSmartComposer")) $("donorChatSmartComposer").style.display = "block";
      if ($("donorChatIntakeComposer")) $("donorChatIntakeComposer").style.display = "none";
      if ($("donorChatThreadComposer")) $("donorChatThreadComposer").style.display = "none";
    }
    setTimeout(function(){ box.scrollTop = box.scrollHeight; }, 30);
    return true;
  } finally {
    donorChatRestoringLocalDraft = false;
  }
}

function donorChatActionButton(label, page, icon) {
  return '<button type="button" class="chat-inline-action" onclick="showPage(\'' + page + '\')"><i class="bi ' + (icon || 'bi-arrow-right') + '"></i> ' + escapeHtml(label) + '</button>';
}

async function donorChatHoursAnswer() {
  const today = todayISO();
  const d = isoDateObj(today);
  const day = d ? d.getDay() : 1;
  let normal = (day === 0 || day === 6)
    ? '<b>วันนี้เวลารับลงทะเบียนปกติ</b><br>09:30–11:30 น. และ 13:00–16:30 น.<br><small>พักเที่ยง 12:00–13:00 น.</small>'
    : '<b>วันนี้เวลารับลงทะเบียนปกติ</b><br>08:30–11:30 น. และ 13:00–15:30 น.<br><small>พักเที่ยง 12:00–13:00 น.</small>';
  try {
    const { data } = await sb.rpc("get_room_calendar", { p_month:today.slice(0,7) });
    const events = Array.isArray(data?.events) ? data.events : [];
    const ev = events.find(function(x){ return x.date === today; });
    if (data?.published && ev) {
      if (ev.type === 'closed') normal = '<b>วันนี้ปิดทำการ</b>' + (ev.title ? '<br>' + escapeHtml(ev.title) : '') + (ev.note ? '<br><small>' + escapeHtml(ev.note) + '</small>' : '');
      else if (ev.type === 'mobile_unit') normal = '<b>วันนี้มีออกหน่วยนอกสถานที่</b>' + (ev.title ? '<br>' + escapeHtml(ev.title) : '') + (ev.time ? '<br>' + escapeHtml(ev.time) : '') + (ev.note ? '<br><small>' + escapeHtml(ev.note) + '</small>' : '');
      else normal = '<b>วันนี้มีประกาศพิเศษ</b>' + (ev.title ? '<br>' + escapeHtml(ev.title) : '') + (ev.time ? '<br>' + escapeHtml(ev.time) : '') + (ev.note ? '<br><small>' + escapeHtml(ev.note) + '</small>' : '');
    }
  } catch (e) { console.warn('chat hours', e); }
  appendDonorAutoAnswer(normal + '<div class="chat-inline-actions">' + donorChatActionButton('ดูปฏิทินทั้งเดือน','roomCalendar','bi-calendar-event') + '</div>');
}

function donorChatAutoBadge() {
  return '<span class="chat-auto-badge"><i class="bi bi-stars"></i> คำตอบอัตโนมัติ</span>';
}

function appendDonorAutoAnswer(content) {
  appendDonorChatBubble('bot', donorChatAutoBadge() + content, true);
}

function donorChatCategoryButton(label, category, icon) {
  return '<button type="button" class="chat-inline-action" onclick="selectDonorQuestionCategory(\'' + category + '\')"><i class="bi ' + (icon || 'bi-chat-dots') + '"></i> ' + escapeHtml(label) + '</button>';
}

function donorChatNormalizeText(value) {
  return String(value || '').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[!?？。、,.\-_/()\[\]{}:;]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function donorChatHasAny(text, words) {
  return words.some(function(word){ return text.indexOf(word) !== -1; });
}

function donorChatDetectIntent(rawText) {
  const t = donorChatNormalizeText(rawText);
  if (!t) return 'empty';
  if (donorChatHasAny(t, ['หมดสติ','หายใจลำบาก','เจ็บหน้าอก','เลือดออกไม่หยุด','เลือดออกมาก','อาการแย่ลง','ชัก'])) return 'post_donation_urgent';
  if (donorChatHasAny(t, ['ผลตรวจ','ผลเลือด','แจ้งให้ติดต่อ','โทรกลับเรื่องผล','ผลติดเชื้อ','ผลผิดปกติ'])) return 'test_result';
  if (donorChatHasAny(t, ['หลังบริจาค','บริจาคแล้วเวียนหัว','บริจาคแล้วหน้ามืด','บริจาคแล้วช้ำ','ปวดแขนหลังบริจาค','เลือดซึม','เวียนหัวหลัง','หน้ามืดหลัง'])) return 'post_donation';
  if (donorChatHasAny(t, ['ถอนฟัน','ผ่าฟันคุด','ทำฟัน'])) return 'dental';
  if (donorChatHasAny(t, ['ยาปฏิชีวนะ','แผลอักเสบ','แผลติดเชื้อ'])) return 'antibiotic';
  if (donorChatHasAny(t, ['ตั้งครรภ์','หลังคลอด','ให้นม'])) return 'pregnancy';
  if (donorChatHasAny(t, ['วัคซีน','ฉีดวัคซีน','ยา','กินยา','ทานยา','ความดัน','เบาหวาน','โรคประจำตัว','เพิ่งป่วย','เป็นหวัด','มีไข้','ไอ','เจ็บคอ'])) return 'eligibility';
  if (donorChatHasAny(t, ['เปิดไหม','ปิดไหม','เปิดกี่โมง','ปิดกี่โมง','เวลาเปิด','เวลาปิด','เวลาทำการ','วันนี้เปิด','วันนี้ปิด','วันหยุด'])) return 'hours';
  if (donorChatHasAny(t, ['ครั้งหน้าบริจาค','ครั้งต่อไป','บริจาคอีกที','บริจาคได้อีก','วันบริจาคครั้งถัดไป','เช็กสิทธิ์'])) return 'next';
  if (donorChatHasAny(t, ['donor id','donorid','เลขผู้บริจาค','รหัสผู้บริจาค','ลืม donor','ลืมเลข'])) return 'donor_id';
  if (donorChatHasAny(t, ['ยกเลิกคิว','ยกเลิกนัด','เลื่อนนัด','ดูนัด','เช็กนัด','รายละเอียดนัด'])) return 'manage_booking';
  if (donorChatHasAny(t, ['เกล็ดเลือด','platelet','จองเกล็ด'])) return 'platelet';
  if (donorChatHasAny(t, ['หมู่คณะ','เป็นกลุ่ม','กลุ่มบริจาค','มากกว่า 10 คน'])) return 'group';
  if (donorChatHasAny(t, ['ออกหน่วย','นอกสถานที่','รถรับบริจาค','40 คน'])) return 'mobile_unit';
  if (donorChatHasAny(t, ['เตรียมตัว','ก่อนบริจาค','นอนกี่ชั่วโมง','พักผ่อน','ดื่มน้ำ','กินข้าว','อาหาร','แอลกอฮอล์','เหล้า','เบียร์'])) return 'prepare';
  if (donorChatHasAny(t, ['ที่ไหน','อยู่ไหน','แผนที่','เบอร์โทร','โทรศัพท์','ติดต่อ','สถานที่'])) return 'contact';
  if (donorChatHasAny(t, ['บริจาคแบบไหน','เลือดแดง','บริจาคเลือดธรรมดา','walk in','walk-in'])) return 'donate';
  return 'unknown';
}

async function donorChatRespondToKind(kind) {
  if (kind === 'hours') { await donorChatHoursAnswer(); return true; }
  if (kind === 'next') {
    appendDonorAutoAnswer('<b>เช็กวันบริจาคครั้งถัดไปจากประวัติของคุณได้เลยค่ะ</b><span>ใช้ Donor ID + วันเกิด + เบอร์โทร เพื่อยืนยันข้อมูล</span><div class="chat-inline-actions">' + donorChatActionButton('เช็กครั้งถัดไป','check','bi-calendar-heart') + '</div>'); return true;
  }
  if (kind === 'donor_id') {
    appendDonorAutoAnswer('<b>ลืม Donor ID ก็ยังเช็กข้อมูลได้ค่ะ</b><span>ที่หน้าเช็กครั้งถัดไป ระบบมีตัวช่วยค้นหา Donor ID จากข้อมูลยืนยันตัวตนของผู้บริจาค</span><div class="chat-inline-actions">' + donorChatActionButton('ไปหน้าเช็กครั้งถัดไป','check','bi-person-vcard') + '</div>'); return true;
  }
  if (kind === 'platelet') {
    appendDonorAutoAnswer('<b>บริจาคเกล็ดเลือดต้องจองล่วงหน้าค่ะ</b><span>เปิดวันจันทร์–ศุกร์ รอบ 09:00 และ 13:00 น. รอบละ 2 คน และต้องจองล่วงหน้าอย่างน้อย 24 ชั่วโมง</span><div class="chat-inline-actions">' + donorChatActionButton('ดูคิว / จองเกล็ดเลือด','screening','bi-droplet-half') + '</div>'); return true;
  }
  if (kind === 'prepare') {
    appendDonorAutoAnswer('<b>ก่อนบริจาค</b><span>• พักผ่อนให้พอ อย่างน้อยประมาณ 5 ชั่วโมง<br>• รับประทานอาหารตามปกติ และเลี่ยงอาหารไขมันสูง<br>• ดื่มน้ำประมาณ 300–500 มล. ก่อนบริจาคราว 30 นาที<br>• งดแอลกอฮอล์อย่างน้อย 24 ชั่วโมง</span><div class="chat-inline-actions">' + donorChatActionButton('ดูวิธีเตรียมตัวทั้งหมด','prepare','bi-cup-straw') + '</div>'); return true;
  }
  if (kind === 'donate') {
    appendDonorAutoAnswer('<b>เลือกได้ตามนี้ค่ะ</b><span>• เลือดแดง: Walk-in ได้ในวันเปิดทำการ<br>• หมู่คณะมากกว่า 10 คน: แจ้งนัดหมายล่วงหน้า<br>• ขอออกหน่วยนอกสถานที่: สำหรับประมาณ 40 คนขึ้นไป</span><div class="chat-inline-actions">' + donorChatActionButton('เลือกประเภทการบริจาค','donationChoice','bi-heart-pulse') + '</div>'); return true;
  }
  if (kind === 'group') {
    appendDonorAutoAnswer('<b>ถ้ามาเป็นหมู่คณะมากกว่า 10 คน สามารถแจ้งนัดหมายล่วงหน้าได้ค่ะ</b><span>ระบบมีแบบฟอร์มสำหรับแจ้งวันและจำนวนผู้บริจาค เพื่อให้ทีมเตรียมความพร้อม</span><div class="chat-inline-actions">' + donorChatActionButton('แจ้งนัดหมู่คณะ','groupBooking','bi-people') + '</div>'); return true;
  }
  if (kind === 'mobile_unit') {
    appendDonorAutoAnswer('<b>สามารถส่งคำขอออกหน่วยรับบริจาคโลหิตนอกสถานที่ได้ค่ะ</b><span>เหมาะสำหรับหน่วยงานหรือชุมชนที่คาดว่าจะมีผู้บริจาคประมาณ 40 คนขึ้นไป ทีมจะตรวจสอบรายละเอียดก่อนยืนยัน</span><div class="chat-inline-actions">' + donorChatActionButton('ส่งคำขอออกหน่วย','mobileUnitRequest','bi-truck') + '</div>'); return true;
  }
  if (kind === 'manage_booking') {
    appendDonorAutoAnswer('<b>ดูรายละเอียดนัดหรือยกเลิกคิวได้จากเมนูจัดการนัดค่ะ</b><span>ใช้ข้อมูลนัดหมายที่ระบบออกให้หลังจอง เพื่อเปิดรายการของคุณ</span><div class="chat-inline-actions">' + donorChatActionButton('ดู / จัดการนัด','manage','bi-ticket-perforated') + '</div>'); return true;
  }
  if (kind === 'contact') {
    appendDonorAutoAnswer('<b>ติดต่อห้องบริจาคโลหิต</b><span>โทร 02-839-6050<br>โรงพยาบาลรามาธิบดีจักรีนฤบดินทร์</span><div class="chat-inline-actions">' + donorChatActionButton('ดูแผนที่และรายละเอียด','info','bi-geo-alt') + '</div>'); return true;
  }
  if (kind === 'dental') {
    appendDonorAutoAnswer('<b>ถ้าถอนฟัน ผ่าฟันคุด หรือทำหัตถการทางทันตกรรมภายใน 7 วันที่ผ่านมา</b><span>กรุณาให้เจ้าหน้าที่ช่วยประเมินระยะเวลาที่เหมาะสมก่อนบริจาคค่ะ</span><div class="chat-inline-actions">' + donorChatCategoryButton('ให้ทีมช่วยประเมิน','eligibility','bi-person-check') + '</div>'); return true;
  }
  if (kind === 'antibiotic') {
    appendDonorAutoAnswer('<b>ถ้ามีแผลอักเสบ ติดเชื้อ หรือกำลังรับประทานยาปฏิชีวนะ</b><span>ควรให้เจ้าหน้าที่ประเมินก่อนจองหรือก่อนมาบริจาคค่ะ</span><div class="chat-inline-actions">' + donorChatCategoryButton('ส่งรายละเอียดให้ทีม','eligibility','bi-capsule') + '</div>'); return true;
  }
  if (kind === 'pregnancy') {
    appendDonorAutoAnswer('<b>กรณีตั้งครรภ์ หลังคลอด หรืออยู่ระหว่างให้นมบุตร</b><span>ต้องประเมินความพร้อมเป็นรายกรณีค่ะ ผู้ช่วยจะไม่ฟันธงจากข้อความสั้น ๆ</span><div class="chat-inline-actions">' + donorChatCategoryButton('ให้ทีมช่วยประเมิน','eligibility','bi-person-check') + '</div>'); return true;
  }
  return false;
}


function donorKnowledgeCategoryLabel(category) {
  const map = {
    general:"ข้อมูลทั่วไป",
    booking:"การจอง / นัดหมาย",
    eligibility:"คุณสมบัติ / ยา / วัคซีน / เพิ่งป่วย",
    post_donation:"อาการหลังบริจาค",
    test_result:"ผลตรวจ / ติดต่อกลับ",
    other:"อื่น ๆ"
  };
  return map[category] || "อื่น ๆ";
}

async function loadPublicDonorKnowledge(force) {
  const now = Date.now();
  if (!force && donorKnowledgeCache.length && (now - donorKnowledgeLoadedAt) < 60 * 1000) return donorKnowledgeCache;
  try {
    const { data, error } = await sb.rpc("public_donor_knowledge");
    if (error) throw error;
    donorKnowledgeCache = Array.isArray(data) ? data : [];
    donorKnowledgeLoadedAt = now;
  } catch (e) {
    console.warn("knowledge base unavailable", e);
    donorKnowledgeCache = [];
    donorKnowledgeLoadedAt = now;
  }
  return donorKnowledgeCache;
}

function donorKnowledgeKeywordList(item) {
  const raw = Array.isArray(item?.keywords) ? item.keywords : [];
  return raw.map(function(x){ return donorChatNormalizeText(x); }).filter(function(x){ return x.length >= 2; });
}

function donorKnowledgeMatch(rawText, items) {
  const text = donorChatNormalizeText(rawText);
  if (!text || text.length < 3) return null;
  let best = null;
  let bestScore = 0;
  (items || []).forEach(function(item){
    const q = donorChatNormalizeText(item?.question || "");
    if (!q) return;
    let score = 0;
    if (text === q) score = 100;
    else if (text.length >= 8 && q.length >= 8 && (text.includes(q) || q.includes(text))) score = 88;
    const keys = donorKnowledgeKeywordList(item);
    let hit = 0;
    keys.forEach(function(k){ if (text.includes(k)) hit += 1; });
    // keywords are curated by Staff; one specific keyword is enough to be a strong match.
    if (hit) score = Math.max(score, Math.min(92, 82 + (hit - 1) * 5));
    // For medical topics require a stronger match. Staff can improve matching by adding keyword phrases.
    const medical = ["eligibility","post_donation","test_result"].includes(item?.category);
    const threshold = medical ? 78 : 66;
    if (score >= threshold && score > bestScore) { best = item; bestScore = score; }
  });
  return best;
}

async function donorChatAnswerFromKnowledge(rawText) {
  const items = await loadPublicDonorKnowledge(false);
  const match = donorKnowledgeMatch(rawText, items);
  if (!match) return false;
  const forwardCategory = ["eligibility","post_donation","test_result"].includes(match.category) ? match.category : "other";
  appendDonorChatBubble('bot', '<span class="chat-auto-badge knowledge"><i class="bi bi-journal-check"></i> คำตอบจากคลังของหน่วย</span><b>' + escapeHtml(match.question || 'คำตอบที่เกี่ยวข้อง') + '</b><span>' + escapeHtml(match.answer || '').replace(/\n/g,'<br>') + '</span><small class="chat-knowledge-note">คำตอบนี้เป็นข้อความมาตรฐานที่เจ้าหน้าที่ของหน่วยบันทึกไว้ หากรายละเอียดของคุณต่างจากกรณีนี้ สามารถส่งให้เจ้าหน้าที่ช่วยดูเพิ่มเติมได้ค่ะ</small><div class="chat-inline-actions">' + donorChatCategoryButton('ส่งรายละเอียดให้เจ้าหน้าที่', forwardCategory, 'bi-person-check') + '</div>', true);
  return true;
}

async function submitDonorSmartQuestion() {
  const input = $('donorChatSmartInput');
  const raw = String(input?.value || '').trim();
  if (!raw) return;
  if (input) input.value = '';
  donorChatPendingEscalationMessage = '';
  appendDonorChatBubble('user', raw);
  if (await donorChatAnswerFromKnowledge(raw)) return;
  const intent = donorChatDetectIntent(raw);
  if (["dental","antibiotic","pregnancy","eligibility","post_donation","post_donation_urgent","test_result","unknown"].includes(intent)) {
    donorChatPendingEscalationMessage = raw;
    donorChatPersistDraft();
  }
  if (await donorChatRespondToKind(intent)) return;

  if (intent === 'eligibility') {
    appendDonorAutoAnswer('<b>เรื่องยา วัคซีน โรคประจำตัว หรือเพิ่งป่วย ต้องดูรายละเอียดแต่ละกรณีค่ะ</b><span>กดส่งให้ทีมได้เลย ระบบจะใช้คำถามที่พิมพ์ไว้แล้ว ไม่ต้องพิมพ์ซ้ำ</span><div class="chat-inline-actions">' + donorChatCategoryButton('ส่งให้ทีมช่วยประเมิน','eligibility','bi-capsule') + '</div>');
    return;
  }
  if (intent === 'post_donation' || intent === 'post_donation_urgent') {
    if (intent === 'post_donation_urgent') appendDonorChatBubble('bot','<span class="chat-medical-alert"><b>ถ้าอาการรุนแรง ไม่ต้องรอคำตอบในแอพ</b><br>หากหมดสติ หายใจลำบาก เจ็บหน้าอก เลือดออกมากไม่หยุด หรืออาการแย่ลงรวดเร็ว ให้ไปห้องฉุกเฉินหรือโทร 1669 ทันที</span>',true);
    appendDonorAutoAnswer('<b>อาการหลังบริจาคควรให้ผู้รับผิดชอบทางการแพทย์ช่วยดูค่ะ</b><span>กดส่งต่อ แล้วระบบจะถามเฉพาะข้อมูลที่จำเป็นจริง ๆ</span><div class="chat-inline-actions">' + donorChatCategoryButton('ส่งอาการให้ทีม','post_donation','bi-heart-pulse-fill') + '</div>');
    return;
  }
  if (intent === 'test_result') {
    appendDonorAutoAnswer('<b>เรื่องผลตรวจต้องตรวจสอบข้อมูลจริงก่อนตอบค่ะ</b><span>กดส่งให้ทีมได้เลย ไม่ต้องพิมพ์คำถามซ้ำ</span><div class="chat-inline-actions">' + donorChatCategoryButton('ส่งให้ทีมตรวจสอบ','test_result','bi-file-medical') + '</div>');
    return;
  }

  appendDonorAutoAnswer('<b>คำถามนี้ระบบยังไม่ควรเดาคำตอบค่ะ</b><span>กดส่งให้เจ้าหน้าที่ได้เลย ระบบจะเก็บคำถามที่พิมพ์ไว้ให้ ไม่ต้องกรอกใหม่</span><div class="chat-inline-actions">' + donorChatCategoryButton('ส่งให้เจ้าหน้าที่','other','bi-chat-square-text') + '</div>');
}

function showDonorChatQuickAnswer(kind) {
  const labels = { hours:'วันนี้เปิดไหม', next:'ครั้งหน้าบริจาคเมื่อไหร่', platelet:'จองเกล็ดเลือด', prepare:'เตรียมตัวยังไง', donate:'บริจาคแบบไหน', contact:'ติดต่อ / แผนที่' };
  appendDonorChatBubble('user', labels[kind] || 'สอบถามข้อมูล');
  donorChatRespondToKind(kind);
}

function donorChatSetTopicChoicesVisible(visible) {
  ["donorChatQuickChoices"].forEach(function(id){ if ($(id)) $(id).style.display = visible ? "" : "none"; });
  document.querySelectorAll(".donor-chat-divider,.donor-chat-human-choices").forEach(function(el){ el.style.display = visible ? "" : "none"; });
}

function donorChatBuildIntakeSteps(category) {
  const steps = [];
  const detailPrompt = category === "post_donation"
    ? "เล่าอาการที่เกิดขึ้นสั้น ๆ ได้เลยค่ะ ตอนนี้ยังมีอาการอยู่ไหม?"
    : category === "test_result"
      ? "ได้รับแจ้งเรื่องผลตรวจอย่างไร หรือต้องการสอบถามเรื่องไหนคะ?"
      : category === "eligibility"
        ? "พิมพ์เรื่องที่อยากให้ช่วยประเมินได้เลยค่ะ เช่น ชื่อยา วัคซีน หรืออาการที่เพิ่งหาย"
        : "พิมพ์เรื่องที่อยากสอบถามได้เลยค่ะ";
  steps.push({ key:"message", type:"textarea", prompt:detailPrompt, placeholder:"พิมพ์รายละเอียด...", required:true });
  if (category === "post_donation") {
    steps.push({ key:"symptom_type", type:"choices", prompt:"อาการหลักใกล้เคียงข้อไหนคะ?", required:false, choices:[
      ["เวียนหัว / หน้ามืด / อ่อนเพลีย","เวียนหัว / หน้ามืด"],
      ["ช้ำ / ปวดแขน","ช้ำ / ปวดแขน"],
      ["เลือดซึมจากแผลเจาะ","เลือดซึม"],
      ["บวม / ชา / ปวดมาก","บวม / ชา / ปวดมาก"],
      ["มีไข้หรือไม่สบายหลังบริจาค","มีไข้ / ไม่สบาย"],
      ["อื่น ๆ","อื่น ๆ"]
    ]});
  }
  if (category === "post_donation") {
    steps.push({ key:"donation_date", type:"date", prompt:"ถ้าจำได้ บริจาควันที่เท่าไหร่คะ?", optional:true });
  }
  steps.push({ key:"donor_name", type:"text", prompt:"ขอชื่อ-นามสกุลสำหรับให้ทีมตรวจสอบค่ะ", placeholder:"ชื่อ-นามสกุล", required:true });
  steps.push({ key:"phone", type:"tel", prompt:"ขอเบอร์โทรที่ติดต่อกลับได้ค่ะ", placeholder:"เช่น 0812345678", required:true });
  if (["eligibility","post_donation","test_result"].includes(category)) {
    steps.push({ key:"donor_id", type:"text", prompt:"ถ้าทราบ Donor ID ใส่ได้เลยค่ะ ไม่ทราบกดข้ามได้", placeholder:"Donor ID (ไม่บังคับ)", optional:true });
  }
  steps.push({ key:"confirm", type:"confirm", prompt:"เรียบร้อยค่ะ ต้องการส่งให้ทีมช่วยดูเลยไหม?" });
  return steps;
}

function donorChatCurrentStep() {
  if (!donorChatIntakeState) return null;
  return donorChatIntakeState.steps[donorChatIntakeState.stepIndex] || null;
}

function donorChatClearComposerInputs() {
  ["donorChatStepInput","donorChatStepTextarea","donorChatStepDate"].forEach(function(id){ if ($(id)) $(id).value = ""; });
}

function donorChatRenderStep() {
  const state = donorChatIntakeState;
  const step = donorChatCurrentStep();
  const composer = $("donorChatIntakeComposer");
  const prompt = $("donorChatPromptText");
  const choices = $("donorChatChoiceReplies");
  const row = $("donorChatInputRow");
  const input = $("donorChatStepInput");
  const textarea = $("donorChatStepTextarea");
  const date = $("donorChatStepDate");
  const skip = $("donorChatSkipStep");
  const send = $("donorChatSendStep");
  if (!state || !step || !composer) return;

  composer.style.display = "block";
  if (state.lastPromptIndex !== state.stepIndex) {
    appendDonorChatBubble("bot", step.prompt || "พิมพ์คำตอบได้เลยค่ะ");
    state.lastPromptIndex = state.stepIndex;
  }
  if (prompt) prompt.innerHTML = '<span><i class="bi bi-keyboard"></i> ' + (step.optional ? 'ตอบด้านล่าง หรือกดข้ามได้' : (step.type === "choices" || step.type === "confirm" ? 'แตะคำตอบด้านล่าง' : 'พิมพ์คำตอบแล้วกดส่ง')) + '</span>';
  if (choices) { choices.innerHTML = ""; choices.style.display = "none"; }
  if (row) row.style.display = "flex";
  if (input) input.style.display = "none";
  if (textarea) textarea.style.display = "none";
  if (date) date.style.display = "none";
  if (skip) skip.style.display = step.optional ? "inline-flex" : "none";
  if (send) send.style.display = "inline-flex";
  donorChatClearComposerInputs();

  if (step.type === "choices" || step.type === "confirm") {
    if (row) row.style.display = "none";
    if (choices) {
      choices.style.display = "flex";
      const opts = step.type === "confirm"
        ? [["__submit__","ส่งให้ทีมเลย"],["__restart__","เริ่มใหม่"]]
        : (step.choices || []);
      choices.innerHTML = opts.map(function(opt){
        const value = Array.isArray(opt) ? opt[0] : opt;
        const label = Array.isArray(opt) ? opt[1] : opt;
        const primary = value === "__submit__" ? " primary" : "";
        return '<button type="button" class="donor-chat-reply-chip' + primary + '" onclick=\'chooseDonorChatReply(' + JSON.stringify(String(value)) + ',' + JSON.stringify(String(label)) + ')\'>' + escapeHtml(label) + '</button>';
      }).join("");
      if (step.optional && step.type === "choices") {
        choices.innerHTML += '<button type="button" class="donor-chat-reply-chip muted" onclick="skipDonorChatStep()">ข้าม</button>';
      }
    }
  } else if (step.type === "textarea") {
    if (textarea) { textarea.style.display = "block"; textarea.placeholder = step.placeholder || "พิมพ์ข้อความ..."; setTimeout(function(){ textarea.focus(); }, 60); }
  } else if (step.type === "date") {
    if (date) { date.style.display = "block"; date.max = todayISO(); setTimeout(function(){ date.focus(); }, 60); }
  } else {
    if (input) {
      input.style.display = "block";
      input.type = step.type === "email" ? "email" : "text";
      input.inputMode = step.type === "tel" ? "numeric" : "text";
      input.placeholder = step.placeholder || "พิมพ์คำตอบ...";
      setTimeout(function(){ input.focus(); }, 60);
    }
  }
  donorChatPersistDraft();
  composer.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function donorChatAdvanceStep() {
  if (!donorChatIntakeState) return;
  donorChatIntakeState.stepIndex += 1;
  donorChatRenderStep();
}

function donorChatStoreStepValue(step, rawValue, displayValue) {
  if (!donorChatIntakeState || !step) return false;
  let value = String(rawValue || "").trim();
  if (step.key === "phone") value = onlyDigits(value);
  if (step.required && value.length < (step.key === "message" ? 3 : step.key === "phone" ? 9 : 2)) {
    const msg = step.key === "phone" ? "กรุณากรอกเบอร์โทรให้ครบ เพื่อให้ทีมติดต่อกลับได้ค่ะ" : "ขอข้อมูลเพิ่มอีกนิดนะคะ เพื่อให้ทีมช่วยดูได้ถูกต้อง";
    appendDonorChatBubble("bot", msg);
    return false;
  }
  if (step.key === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) {
    appendDonorChatBubble("bot", "อีเมลเหมือนยังไม่ครบค่ะ ลองพิมพ์ใหม่ หรือกดข้ามได้เลย");
    return false;
  }
  donorChatIntakeState.data[step.key] = value || null;
  if (value) appendDonorChatBubble("user", displayValue || value);
  donorChatAdvanceStep();
  return true;
}

function submitDonorChatStep() {
  const step = donorChatCurrentStep();
  if (!step) return;
  let value = "";
  if (step.type === "textarea") value = $("donorChatStepTextarea")?.value || "";
  else if (step.type === "date") value = $("donorChatStepDate")?.value || "";
  else value = $("donorChatStepInput")?.value || "";
  if (!String(value || "").trim() && step.optional) { skipDonorChatStep(); return; }
  donorChatStoreStepValue(step, value, step.type === "date" && value ? isoToThaiDate(value, true) : value);
}

function skipDonorChatStep() {
  const step = donorChatCurrentStep();
  if (!step || !step.optional || !donorChatIntakeState) return;
  donorChatIntakeState.data[step.key] = null;
  appendDonorChatBubble("user", "ข้าม");
  donorChatAdvanceStep();
}

function chooseDonorChatReply(value, label) {
  const step = donorChatCurrentStep();
  if (!step) return;
  if (value === "__restart__") { startNewDonorChat(); return; }
  if (value === "__submit__") { submitDonorChatIntake(); return; }
  donorChatStoreStepValue(step, value, label || value);
}

function showDonorAskEntry() {
  const entry = $("donorAskEntry");
  const panel = $("donorMyQuestionsPanel");
  const shell = $("donorChatShell");
  if (entry) entry.style.display = "block";
  if (panel) panel.style.display = "none";
  if (shell) shell.style.display = "none";
  if ($("donorQuestionEmergency")) $("donorQuestionEmergency").style.display = "none";
}

function showDonorAskChat() {
  const entry = $("donorAskEntry");
  const panel = $("donorMyQuestionsPanel");
  const shell = $("donorChatShell");
  if (entry) entry.style.display = "none";
  if (panel) panel.style.display = "none";
  if (shell) shell.style.display = "flex";
}

function openDonorQuestionHistory() {
  const entry = $("donorAskEntry");
  const panel = $("donorMyQuestionsPanel");
  const shell = $("donorChatShell");
  if (entry) entry.style.display = "none";
  if (shell) shell.style.display = "none";
  if (panel) panel.style.display = "block";
  renderDonorMyQuestions();
}

function toggleDonorCrossDeviceLookup(force) {
  const box = $("donorQuestionCrossDevice");
  if (!box) return;
  const next = typeof force === "boolean" ? force : box.style.display === "none";
  box.style.display = next ? "block" : "none";
  box.open = !!next;
  if (next) setTimeout(function(){ box.scrollIntoView({ behavior:"smooth", block:"nearest" }); }, 20);
}

function startNewDonorChat() {
  showDonorAskChat();
  donorChatIntakeState = null;
  clearDonorChatResume();
  donorChatClearDraft();
  const messages = $("donorChatMessages");
  if (messages) messages.innerHTML = donorChatInitialGreetingHtml();
  donorChatSetTopicChoicesVisible(true);
  if ($("donorChatSmartComposer")) $("donorChatSmartComposer").style.display = "block";
  if ($("donorChatSmartInput")) $("donorChatSmartInput").value = "";
  if ($("donorChatIntakeComposer")) $("donorChatIntakeComposer").style.display = "none";
  if ($("donorChatThreadComposer")) $("donorChatThreadComposer").style.display = "none";
  if ($("donorQuestionEmergency")) $("donorQuestionEmergency").style.display = "none";
  toggleDonorMyQuestions(false);
}

function selectDonorQuestionCategory(category) {
  const label = donorQuestionCategoryLabel(category);
  const initialMessage = String(donorChatPendingEscalationMessage || "").trim();
  donorChatPendingEscalationMessage = "";
  if ($("donorChatSmartComposer")) $("donorChatSmartComposer").style.display = "none";
  if (!initialMessage) appendDonorChatBubble("user", label);
  donorChatSetTopicChoicesVisible(false);
  if ($("donorChatThreadComposer")) $("donorChatThreadComposer").style.display = "none";
  const helper = category === "post_donation"
    ? "ได้ค่ะ จะถามเฉพาะข้อมูลที่จำเป็น แล้วส่งให้ผู้รับผิดชอบทางการแพทย์ช่วยดูนะคะ"
    : category === "test_result"
      ? "ได้ค่ะ เรื่องผลตรวจจะส่งให้ทีมตรวจสอบข้อมูลจริงก่อนตอบนะคะ"
      : initialMessage
        ? "ได้เลยค่ะ ใช้คำถามที่พิมพ์ไว้แล้ว ขอข้อมูลติดต่ออีกนิดเดียวเพื่อส่งให้ทีมค่ะ"
        : "ได้เลยค่ะ ขอข้อมูลที่จำเป็นสั้น ๆ แล้วส่งให้ทีมช่วยดูค่ะ";
  appendDonorChatBubble("bot", helper);
  if (category === "post_donation") {
    appendDonorChatBubble("bot", '<span class="chat-medical-alert"><b>ถ้าอาการรุนแรง ไม่ต้องรอคำตอบในแอพ</b><br>หากหมดสติ หายใจลำบาก เจ็บหน้าอก เลือดออกมากไม่หยุด หรืออาการแย่ลงรวดเร็ว ให้ไปห้องฉุกเฉินหรือโทร 1669 ทันที</span>', true);
  }
  let steps = donorChatBuildIntakeSteps(category);
  const data = { category:category, subject:label };
  if (initialMessage) {
    data.message = initialMessage;
    steps = steps.filter(function(step){ return step.key !== "message"; });
  }
  donorChatIntakeState = {
    category:category,
    stepIndex:0,
    data:data,
    steps:steps
  };
  donorChatPersistDraft();
  donorChatRenderStep();
}

async function submitDonorChatIntake() {
  if (!donorChatIntakeState) return;
  const d = donorChatIntakeState.data || {};
  const composer = $("donorChatIntakeComposer");
  if (composer) composer.classList.add("sending");
  appendDonorChatBubble("user", "ส่งให้ทีมเลย");
  appendDonorChatBubble("bot", "กำลังส่งให้ทีมค่ะ…");
  try {
    const { data, error } = await sb.rpc("submit_donor_question", {
      p_category:donorChatIntakeState.category,
      p_subject:donorQuestionCategoryLabel(donorChatIntakeState.category),
      p_donor_name:d.donor_name || "",
      p_phone:d.phone || "",
      p_email:null,
      p_donor_id:d.donor_id || null,
      p_donation_date:d.donation_date || null,
      p_symptom_type:d.symptom_type || null,
      p_message:d.message || ""
    });
    if (error) throw error;
    const result = data || {};
    if (!result.ok) throw new Error(result.message || "ส่งคำถามไม่สำเร็จ");
    saveDonorChatResume(result.access_token || "", result.public_code || "", String(d.phone || "").slice(-4), {
      category:donorChatIntakeState.category,
      message:d.message || "",
      status:"ใหม่"
    });
    donorChatIntakeState = null;
    donorChatClearDraft();
    if (composer) { composer.style.display = "none"; composer.classList.remove("sending"); }
    try { await sb.functions.invoke("donor-question-notify", { body:{ action:"send_new", publicCode:result.public_code } }); } catch (notifyErr) { console.warn("question notify failed", notifyErr); }
    const ok = await loadDonorQuestionByToken(result.access_token || "", false);
    if (!ok) {
      appendDonorChatBubble("bot", '<b>ส่งให้ทีมแล้วค่ะ</b><br>เลขอ้างอิง <strong>' + escapeHtml(result.public_code || "-") + '</strong><br>เมื่อทีมตอบสามารถกลับมาเปิดบทสนทนานี้ได้', true);
    }
  } catch (err) {
    if (composer) composer.classList.remove("sending");
    appendDonorChatBubble("bot", "ยังส่งไม่สำเร็จค่ะ กรุณาลองอีกครั้ง หรือโทร 02-839-6050 ในเวลาทำการ");
    showModal({ title:"ยังส่งข้อความไม่ได้", message:err.message || String(err), iconText:"!" });
  }
}

// compatibility: ปุ่ม/โค้ดเก่าที่เรียก submitDonorQuestion จะใช้ flow chat ใหม่
async function submitDonorQuestion() { return submitDonorChatIntake(); }

function getDonorChatHistory() {
  const rows = donorChatReadJson(DONOR_CHAT_STORAGE.history, []);
  return Array.isArray(rows) ? rows.filter(function(row){ return row && (row.accessToken || row.publicCode); }).slice(0,10) : [];
}

function saveDonorChatHistoryEntry(entry) {
  if (!entry || (!entry.accessToken && !entry.publicCode)) return;
  const rows = getDonorChatHistory();
  const token = String(entry.accessToken || "");
  const code = String(entry.publicCode || "").toUpperCase();
  const next = rows.filter(function(row){
    if (token && row.accessToken === token) return false;
    if (code && String(row.publicCode || "").toUpperCase() === code) return false;
    return true;
  });
  next.unshift({
    accessToken:token,
    publicCode:code,
    phoneLast4:String(entry.phoneLast4 || "").slice(-4),
    category:String(entry.category || ""),
    message:String(entry.message || "").slice(0,180),
    status:String(entry.status || ""),
    updatedAt:entry.updatedAt || new Date().toISOString()
  });
  donorChatWriteJson(DONOR_CHAT_STORAGE.history, next.slice(0,10));
  renderDonorMyQuestions();
}

function saveDonorChatResume(accessToken, publicCode, phoneLast4, meta) {
  currentDonorChatAccessToken = String(accessToken || "");
  currentDonorChatPublicCode = String(publicCode || "");
  currentDonorChatPhoneLast4 = String(phoneLast4 || "");
  try {
    if (currentDonorChatAccessToken) localStorage.setItem(DONOR_CHAT_STORAGE.token, currentDonorChatAccessToken);
    else localStorage.removeItem(DONOR_CHAT_STORAGE.token);
    if (currentDonorChatPublicCode) localStorage.setItem(DONOR_CHAT_STORAGE.code, currentDonorChatPublicCode);
    else localStorage.removeItem(DONOR_CHAT_STORAGE.code);
    if (currentDonorChatPhoneLast4) localStorage.setItem(DONOR_CHAT_STORAGE.phone4, currentDonorChatPhoneLast4);
    else localStorage.removeItem(DONOR_CHAT_STORAGE.phone4);
  } catch (e) {}
  if (currentDonorChatAccessToken || currentDonorChatPublicCode) {
    saveDonorChatHistoryEntry(Object.assign({}, meta || {}, {
      accessToken:currentDonorChatAccessToken,
      publicCode:currentDonorChatPublicCode,
      phoneLast4:currentDonorChatPhoneLast4
    }));
  }
}

function clearDonorChatResume() {
  currentDonorChatAccessToken = "";
  currentDonorChatPublicCode = "";
  currentDonorChatPhoneLast4 = "";
  try { localStorage.removeItem(DONOR_CHAT_STORAGE.token); localStorage.removeItem(DONOR_CHAT_STORAGE.code); localStorage.removeItem(DONOR_CHAT_STORAGE.phone4); } catch (e) {}
}

function toggleDonorMyQuestions(force) {
  const panel = $("donorMyQuestionsPanel");
  if (!panel) return;
  const next = typeof force === "boolean" ? force : panel.style.display === "none";
  if (next) openDonorQuestionHistory();
  else panel.style.display = "none";
}

function renderDonorMyQuestions() {
  const box = $("donorMyQuestionList");
  if (!box) return;
  const rows = getDonorChatHistory();
  const prompt = $("donorCrossDevicePrompt");
  const cross = $("donorQuestionCrossDevice");
  if (cross) { cross.style.display = "none"; cross.open = false; }
  if (prompt) {
    prompt.style.display = "flex";
    const text = prompt.querySelector("span");
    if (text) text.textContent = rows.length ? "หาไม่เจอในรายการ?" : "เคยถามจากโทรศัพท์หรือคอมเครื่องอื่น?";
  }
  if (!rows.length) {
    box.innerHTML = '<div class="donor-my-question-empty easy"><i class="bi bi-chat-heart"></i><b>ยังไม่มีคำถามในเครื่องนี้</b><span>หากเคยถามจากเครื่องอื่น กดปุ่มด้านล่างได้ค่ะ</span></div>';
    return;
  }
  box.innerHTML = rows.map(function(row, index){
    const title = donorQuestionCategoryLabel(row.category || "other");
    const detail = row.message ? escapeHtml(row.message) : "แตะเพื่อเปิดบทสนทนา";
    const code = escapeHtml(row.publicCode || "คำถามของฉัน");
    const status = row.status ? '<span class="question-status-pill ' + questionStatusClass(row.status) + '">' + escapeHtml(row.status) + '</span>' : '';
    return '<button type="button" class="donor-my-question-item" onclick="openSavedDonorQuestion(' + index + ')"><span class="donor-my-question-icon"><i class="bi ' + donorQuestionCategoryIcon(row.category || "other") + '"></i></span><span class="donor-my-question-copy"><b>' + escapeHtml(title) + '</b><small>' + detail + '</small><em>' + code + '</em></span>' + status + '<i class="bi bi-chevron-right"></i></button>';
  }).join('');
}
async function openSavedDonorQuestion(index) {
  const row = getDonorChatHistory()[Number(index)];
  if (!row) return;
  toggleDonorMyQuestions(false);
  showDonorAskChat();
  if (row.accessToken) {
    const ok = await loadDonorQuestionByToken(row.accessToken, false);
    if (ok) return;
  }
  if (row.publicCode && String(row.phoneLast4 || "").length === 4) {
    const { data, error } = await sb.rpc("lookup_donor_question", { p_public_code:row.publicCode, p_phone_last4:row.phoneLast4 });
    if (!error && data?.ok) {
      saveDonorChatResume("", row.publicCode, row.phoneLast4, { category:data.question?.category, message:data.question?.message, status:data.question?.status });
      renderDonorQuestionThread(data.question || {}, Array.isArray(data.replies) ? data.replies : [], { publicCode:row.publicCode, phoneLast4:row.phoneLast4 });
      return;
    }
  }
  showModal({title:"เปิดคำถามไม่ได้",message:"หากเคยถามจากเครื่องอื่น สามารถใช้เลขคำถามและเบอร์โทร 4 ตัวท้ายเพื่อเปิดได้ค่ะ",iconText:"!"});
  openDonorQuestionHistory();
}

function renderDonorQuestionThread(q, replies, context) {
  context = context || {};
  showDonorAskChat();
  const box = $("donorChatMessages");
  if (!box) return;
  currentDonorChatPublicCode = q.public_code || context.publicCode || currentDonorChatPublicCode;
  if (context.accessToken) currentDonorChatAccessToken = context.accessToken;
  if (context.phoneLast4) currentDonorChatPhoneLast4 = context.phoneLast4;
  donorChatIntakeState = null;
  donorChatLocalTranscript = [];
  donorChatPendingEscalationMessage = "";
  donorChatSetTopicChoicesVisible(false);
  if ($("donorChatSmartComposer")) $("donorChatSmartComposer").style.display = "none";
  if ($("donorChatIntakeComposer")) $("donorChatIntakeComposer").style.display = "none";
  if ($("donorQuestionEmergency")) $("donorQuestionEmergency").style.display = "none";

  const status = q.status || "ใหม่";
  const category = donorQuestionCategoryLabel(q.category);
  let html = '';
  html += '<div class="chat-thread-meta"><span><i class="bi bi-chat-dots"></i> ' + escapeHtml(q.public_code || "") + '</span><b class="question-status-pill ' + questionStatusClass(status) + '">' + escapeHtml(status) + '</b></div>';
  html += '<div class="chat-row bot"><div class="chat-avatar-mini"><i class="bi bi-droplet-fill"></i></div><div class="chat-bubble"><b>' + escapeHtml(category) + '</b><span>บทสนทนานี้ส่งถึงทีมแล้วค่ะ ตอบต่อในช่องด้านล่างได้เลย</span></div></div>';
  html += '<div class="chat-row user"><div class="chat-bubble"><span>' + escapeHtml(q.message || '') + '</span><small>คุณ · ' + escapeHtml(formatBangkokLogTime(q.created_at, false)) + '</small></div></div>';
  (replies || []).forEach(function(r){
    const donor = r.sender_type === 'donor';
    const label = donor ? 'คุณ' : (r.sender_type === 'doctor' ? 'แพทย์ / ผู้รับผิดชอบ' : 'เจ้าหน้าที่');
    html += '<div class="chat-row ' + (donor ? 'user' : 'bot') + '">' + (donor ? '' : '<div class="chat-avatar-mini"><i class="bi bi-droplet-fill"></i></div>') + '<div class="chat-bubble"><span>' + escapeHtml(r.message || '') + '</span><small>' + escapeHtml(label) + ' · ' + escapeHtml(formatBangkokLogTime(r.created_at, false)) + '</small></div></div>';
  });
  if (!(replies || []).length) {
    html += '<div class="chat-row bot"><div class="chat-avatar-mini"><i class="bi bi-droplet-fill"></i></div><div class="chat-bubble waiting"><span><i class="bi bi-hourglass-split"></i> ทีมได้รับข้อความแล้วค่ะ เมื่อมีคำตอบจะกลับมาอยู่ในบทสนทนานี้</span></div></div>';
  }
  box.innerHTML = html;
  const live = $("donorChatLiveStatus");
  if (live) live.innerHTML = '<span class="question-status-pill ' + questionStatusClass(status) + '">' + escapeHtml(status) + '</span> <span>· ' + escapeHtml(q.public_code || '') + '</span> <button type="button" class="chat-new-thread" onclick="startNewDonorChat()">เริ่มเรื่องใหม่</button>';
  const threadComposer = $("donorChatThreadComposer");
  if (threadComposer) {
    threadComposer.style.display = "block";
    const composeRow = threadComposer.querySelector(".donor-chat-input-row");
    if (composeRow) composeRow.style.display = status === "ปิดเรื่อง" ? "none" : "flex";
  }
  saveDonorChatHistoryEntry({
    accessToken:currentDonorChatAccessToken,
    publicCode:currentDonorChatPublicCode,
    phoneLast4:currentDonorChatPhoneLast4,
    category:q.category,
    message:q.message,
    status:status,
    updatedAt:q.updated_at || q.created_at
  });
  setTimeout(function(){ box.scrollTop = box.scrollHeight; box.lastElementChild?.scrollIntoView({ behavior:"smooth", block:"nearest" }); }, 40);
}

function copyTextValue(value) {
  const text = String(value || "");
  if (!text) return;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(function(){ showToastMessage("คัดลอกแล้ว"); }).catch(function(){});
}

async function loadDonorQuestionByToken(token, scroll) {
  token = String(token || currentDonorChatAccessToken || '').trim();
  if (!token) return false;
  const { data, error } = await sb.rpc('lookup_donor_question_token', { p_access_token:token });
  if (error || !data?.ok) return false;
  donorChatClearDraft();
  const remembered = getDonorChatHistory().find(function(row){ return row.accessToken === token; });
  const rememberedPhone4 = currentDonorChatPhoneLast4 || remembered?.phoneLast4 || "";
  saveDonorChatResume(token, data.question?.public_code || '', rememberedPhone4, {
    category:data.question?.category,
    message:data.question?.message,
    status:data.question?.status,
    updatedAt:data.question?.updated_at || data.question?.created_at
  });
  renderDonorQuestionThread(data.question || {}, Array.isArray(data.replies) ? data.replies : [], { accessToken:token });
  if (scroll === false) return true;
  return true;
}

async function restoreDonorChatConversation() {
  if (!$("donorChatMessages")) return;
  showDonorAskEntry();
  if ($("donorChatThreadComposer")?.style.display === 'block' && (currentDonorChatAccessToken || currentDonorChatPublicCode)) {
    showDonorAskChat();
    return;
  }
  let token = currentDonorChatAccessToken;
  let code = currentDonorChatPublicCode;
  let phone4 = currentDonorChatPhoneLast4;
  try {
    token = token || localStorage.getItem(DONOR_CHAT_STORAGE.token) || '';
    code = code || localStorage.getItem(DONOR_CHAT_STORAGE.code) || '';
    phone4 = phone4 || localStorage.getItem(DONOR_CHAT_STORAGE.phone4) || '';
  } catch (e) {}
  if (token) {
    showDonorAskChat();
    const ok = await loadDonorQuestionByToken(token, false);
    if (ok) return;
    clearDonorChatResume();
    code = '';
    phone4 = '';
    showDonorAskEntry();
  }
  if (code && String(phone4).length === 4) {
    showDonorAskChat();
    const { data, error } = await sb.rpc("lookup_donor_question", { p_public_code:code, p_phone_last4:phone4 });
    if (!error && data?.ok) {
      saveDonorChatResume("", code, phone4, { category:data.question?.category, message:data.question?.message, status:data.question?.status, updatedAt:data.question?.updated_at || data.question?.created_at });
      renderDonorQuestionThread(data.question || {}, Array.isArray(data.replies) ? data.replies : [], { publicCode:code, phoneLast4:phone4 });
      return;
    }
    clearDonorChatResume();
    showDonorAskEntry();
  }
  const restored = restoreDonorChatLocalDraft();
  if (restored) {
    showDonorAskChat();
    return;
  }
  renderDonorMyQuestions();
  showDonorAskEntry();
}
async function lookupDonorQuestion() {
  const code = String($("donorQuestionLookupCode")?.value || "").trim().toUpperCase();
  const last4 = onlyDigits($("donorQuestionLookupPhone")?.value || "").slice(-4);
  const box = $("donorQuestionLookupResult");
  if (!code || last4.length !== 4) { showModal({title:"กรอกข้อมูลให้ครบ",message:"กรุณากรอกเลขคำถาม และเบอร์โทร 4 ตัวท้ายที่ใช้ตอนส่งคำถาม",iconText:"!"}); return; }
  if (box) box.innerHTML = '<div class="staff-result">กำลังเปิดบทสนทนา...</div>';
  const { data, error } = await sb.rpc("lookup_donor_question", { p_public_code:code, p_phone_last4:last4 });
  if (error || !data?.ok) { if (box) box.innerHTML = '<div class="staff-result fail">' + escapeHtml(error?.message || data?.message || "ไม่พบรายการ") + '</div>'; return; }
  donorChatClearDraft();
  saveDonorChatResume("", code, last4, {
    category:data.question?.category,
    message:data.question?.message,
    status:data.question?.status,
    updatedAt:data.question?.updated_at || data.question?.created_at
  });
  renderDonorQuestionThread(data.question || {}, Array.isArray(data.replies) ? data.replies : [], { publicCode:code, phoneLast4:last4 });
  if (box) box.innerHTML = '<div class="compact-notice success"><i class="bi bi-check2-circle"></i><span>เปิดบทสนทนาแล้ว คุณสามารถพิมพ์ข้อความต่อได้ด้านบน</span></div>';
}

async function sendDonorQuestionFollowup() {
  const input = $("donorChatFollowupText");
  const message = String(input?.value || '').trim();
  if (message.length < 1) return;
  let data, error;
  if (currentDonorChatAccessToken) {
    ({ data, error } = await sb.rpc('donor_add_question_reply_token', { p_access_token:currentDonorChatAccessToken, p_message:message }));
  } else if (currentDonorChatPublicCode && currentDonorChatPhoneLast4) {
    ({ data, error } = await sb.rpc('donor_add_question_reply', { p_public_code:currentDonorChatPublicCode, p_phone_last4:currentDonorChatPhoneLast4, p_message:message }));
  } else {
    showModal({title:'เปิดบทสนทนาก่อน',message:'กรุณาเปิดคำถามเดิมด้วยเลขคำถามและเบอร์โทร 4 ตัวท้ายก่อนส่งข้อความเพิ่ม',iconText:'!'}); return;
  }
  if (error || !data?.ok) { showModal({title:'ส่งข้อความไม่ได้',message:error?.message || data?.message || 'กรุณาลองใหม่',iconText:'!'}); return; }
  if (input) input.value = '';
  try { await sb.functions.invoke("donor-question-notify", { body:{ action:"send_new", publicCode:data.public_code || currentDonorChatPublicCode } }); } catch (e) { console.warn(e); }
  if (currentDonorChatAccessToken) await loadDonorQuestionByToken(currentDonorChatAccessToken, false);
  else {
    const { data:lookup } = await sb.rpc("lookup_donor_question", { p_public_code:currentDonorChatPublicCode, p_phone_last4:currentDonorChatPhoneLast4 });
    if (lookup?.ok) renderDonorQuestionThread(lookup.question || {}, Array.isArray(lookup.replies) ? lookup.replies : [], { publicCode:currentDonorChatPublicCode, phoneLast4:currentDonorChatPhoneLast4 });
  }
}

function questionStatusClass(status) {
  if (status === "ใหม่") return "new";
  if (status === "รอแพทย์") return "doctor";
  if (status === "ตอบแล้ว") return "answered";
  if (status === "ปิดเรื่อง") return "closed";
  return "working";
}

function setStaffQuestionFilter(filter) {
  staffQuestionFilter = filter || "all";
  document.querySelectorAll('[data-question-filter]').forEach(function(btn){ btn.classList.toggle('active', btn.dataset.questionFilter === staffQuestionFilter); });
  loadStaffQuestions();
}

async function loadStaffQuestions() {
  if (!currentStaffProfile) return;
  const box = $("staffQuestionList");
  if (!box) return;
  box.innerHTML = '<div class="staff-result">กำลังโหลดคำถาม...</div>';
  const { data, error } = await sb.from("donor_questions").select("*").order("updated_at", { ascending:false }).limit(100);
  if (error) { box.innerHTML = '<div class="staff-result fail">โหลดคำถามไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>'; return; }
  const rows = Array.isArray(data) ? data : [];
  const counts = {
    all:rows.filter(q => q.status !== "ปิดเรื่อง").length,
    new:rows.filter(q => q.status === "ใหม่").length,
    doctor:rows.filter(q => q.status === "รอแพทย์" || (q.needs_doctor && !["ตอบแล้ว","ปิดเรื่อง"].includes(q.status))).length,
    answered:rows.filter(q => q.status === "ตอบแล้ว").length
  };
  if ($("questionCountAll")) $("questionCountAll").innerText = counts.all;
  if ($("questionCountNew")) $("questionCountNew").innerText = counts.new;
  if ($("questionCountDoctor")) $("questionCountDoctor").innerText = counts.doctor;
  if ($("questionCountAnswered")) $("questionCountAnswered").innerText = counts.answered;
  updateStaffQuestionBadge(counts.new + counts.doctor);

  let filtered = rows;
  if (staffQuestionFilter === "all") filtered = rows.filter(q => q.status !== "ปิดเรื่อง");
  else if (staffQuestionFilter === "doctor") filtered = rows.filter(q => q.status === "รอแพทย์" || (q.needs_doctor && !["ตอบแล้ว","ปิดเรื่อง"].includes(q.status)));
  else if (staffQuestionFilter === "answered") filtered = rows.filter(q => q.status === "ตอบแล้ว");
  else filtered = rows.filter(q => q.status === staffQuestionFilter);

  if (!filtered.length) { box.innerHTML = '<div class="staff-result">ยังไม่มีคำถามในหมวดนี้</div>'; return; }
  box.innerHTML = '<div class="staff-question-list">' + filtered.map(function(q){
    const medical = q.needs_doctor ? '<span class="question-medical-tag"><i class="bi bi-stethoscope"></i> ต้องให้แพทย์ดู</span>' : '';
    return '<article class="staff-question-card ' + questionStatusClass(q.status) + '">' +
      '<div class="staff-question-main"><div class="staff-question-icon"><i class="bi ' + donorQuestionCategoryIcon(q.category) + '"></i></div><div><div class="staff-question-tags"><span>' + escapeHtml(q.public_code) + '</span>' + medical + '</div><h5>' + escapeHtml(donorQuestionCategoryLabel(q.category)) + '</h5><p>' + escapeHtml(String(q.message || "").slice(0,180)) + (String(q.message || "").length > 180 ? '…' : '') + '</p><small>' + escapeHtml(formatBangkokLogTime(q.created_at, true)) + '</small></div></div>' +
      '<div class="staff-question-side"><span class="question-status-pill ' + questionStatusClass(q.status) + '">' + escapeHtml(q.status) + '</span><button type="button" class="btn btn-soft btn-sm" onclick="openStaffQuestionDetail(\'' + escapeHtml(q.id) + '\')">ดูรายละเอียด</button></div>' +
    '</article>';
  }).join('') + '</div>';
}

async function updateStaffQuestionBadge(countOverride) {
  const badge = $("staffQuestionBadge");
  if (!badge || !currentStaffProfile) return;
  let count = Number(countOverride);
  if (!Number.isFinite(count)) {
    const { count: newCount } = await sb.from("donor_questions").select("id", { count:"exact", head:true }).in("status", ["ใหม่","รอแพทย์"]);
    count = Number(newCount || 0);
  }
  badge.innerText = count > 99 ? "99+" : String(count);
  badge.style.display = count > 0 ? "inline-flex" : "none";
  try {
    if (count > 0 && typeof navigator.setAppBadge === "function") navigator.setAppBadge(count);
    else if (count <= 0 && typeof navigator.clearAppBadge === "function") navigator.clearAppBadge();
  } catch (e) {}
}

async function openStaffQuestionByPublicCode(publicCode) {
  publicCode = String(publicCode || "").trim().toUpperCase();
  if (!publicCode || !currentStaffProfile) return false;
  const { data:q, error } = await sb.from("donor_questions").select("id,public_code").eq("public_code", publicCode).maybeSingle();
  if (error || !q) return false;
  pendingStaffQuestionCode = publicCode;
  await openStaffQuestionDetail(q.id);
  return true;
}

async function openStaffQuestionDetail(id) {
  const { data:q, error } = await sb.from("donor_questions").select("*").eq("id", id).maybeSingle();
  if (error || !q) { showModal({title:"ไม่พบรายการ",message:error?.message || "คำถามนี้อาจถูกลบหรือเปลี่ยนแปลงแล้ว",iconText:"!"}); return; }
  const { data: replies } = await sb.from("donor_question_replies").select("*").eq("question_id", id).order("created_at", { ascending:true });
  currentStaffQuestion = q;
  if ($("staffQuestionDetailTitle")) $("staffQuestionDetailTitle").innerText = q.public_code + " · " + donorQuestionCategoryLabel(q.category);
  if ($("staffQuestionDetailMeta")) $("staffQuestionDetailMeta").innerText = formatBangkokLogTime(q.created_at, true) + " · สถานะ " + q.status;
  const replyHistory = (replies || []).length ? '<div class="question-reply-history"><h6>บทสนทนา</h6>' + replies.map(function(r){ const who = r.sender_type === "donor" ? "ผู้บริจาค" : (r.sender_type === "doctor" ? "แพทย์/ผู้รับผิดชอบ" : "เจ้าหน้าที่"); return '<div class="' + (r.sender_type === "donor" ? 'from-donor' : 'from-team') + '"><b>' + escapeHtml(who) + '</b><span>' + escapeHtml(r.message) + '</span><small>' + escapeHtml(r.sender_name || "") + ' · ' + escapeHtml(formatBangkokLogTime(r.created_at, true)) + '</small></div>'; }).join('') + '</div>' : '';
  if ($("staffQuestionDetailBody")) $("staffQuestionDetailBody").innerHTML = '<div class="question-detail-grid">' +
    '<div><small>ชื่อ</small><b>' + escapeHtml(q.donor_name || "-") + '</b></div><div><small>โทร</small><b><a href="tel:' + escapeHtml(q.phone || "") + '">' + escapeHtml(q.phone || "-") + '</a></b></div>' +
    '<div><small>อีเมล</small><b>' + (q.email ? '<a href="mailto:' + escapeHtml(q.email) + '">' + escapeHtml(q.email) + '</a>' : '-') + '</b></div><div><small>Donor ID</small><b>' + escapeHtml(q.donor_id || "-") + '</b></div>' +
    (q.donation_date ? '<div><small>วันที่บริจาคที่เกี่ยวข้อง</small><b>' + escapeHtml(isoToThaiDate(q.donation_date, true)) + '</b></div>' : '') +
    (q.symptom_type ? '<div><small>อาการหลัก</small><b>' + escapeHtml(q.symptom_type) + '</b></div>' : '') + '</div>' +
    '<div class="question-detail-message"><small>รายละเอียดจากผู้บริจาค</small><p>' + escapeHtml(q.message || "") + '</p></div>' + replyHistory;
  const saveToKnowledgeBtn = $("staffQuestionSaveKnowledgeBtn");
  if (saveToKnowledgeBtn) {
    saveToKnowledgeBtn.style.display = q.last_reply ? "inline-flex" : "none";
    saveToKnowledgeBtn.disabled = !q.last_reply;
  }
  if ($("staffQuestionReplyText")) $("staffQuestionReplyText").value = "";
  if ($("staffQuestionDetailCard")) { $("staffQuestionDetailCard").style.display = "block"; $("staffQuestionDetailCard").scrollIntoView({ behavior:"smooth", block:"start" }); }
}

function closeStaffQuestionDetail() {
  currentStaffQuestion = null;
  if ($("staffQuestionDetailCard")) $("staffQuestionDetailCard").style.display = "none";
}

async function updateStaffQuestion(status, notifyDoctor) {
  if (!currentStaffQuestion) return;
  const reply = String($("staffQuestionReplyText")?.value || "").trim();
  if (status === "ตอบแล้ว" && !reply) { showModal({title:"ยังไม่มีข้อความตอบ",message:"กรุณาพิมพ์คำตอบก่อนกดส่งคำตอบ",iconText:"!"}); return; }
  const senderType = status === "ตอบแล้ว" && currentStaffQuestion.needs_doctor ? "doctor" : "staff";
  const { error } = await sb.rpc("staff_update_donor_question", { p_question_id:currentStaffQuestion.id, p_status:status, p_reply:reply || null, p_sender_type:senderType });
  if (error) { showModal({title:"บันทึกไม่สำเร็จ",message:error.message,iconText:"!"}); return; }
  if (notifyDoctor || status === "รอแพทย์") {
    try { await sb.functions.invoke("donor-question-notify", { body:{ action:"send_doctor", publicCode:currentStaffQuestion.public_code } }); } catch (e) { console.warn(e); }
  }
  showToastMessage(status === "ตอบแล้ว" ? "ส่งคำตอบแล้ว" : "อัปเดตสถานะแล้ว");
  const currentId = currentStaffQuestion.id;
  await loadStaffQuestions();
  await openStaffQuestionDetail(currentId);
}


function knowledgeCategoryFromDonorQuestion(category) {
  if (["eligibility","post_donation","test_result"].includes(category)) return category;
  return "other";
}

function knowledgeSuggestedKeywords(question) {
  const text = donorChatNormalizeText(question);
  const known = [
    "ไวรัสตับอักเสบ","hepatitis b","hep b","hbv","ยาปฏิชีวนะ","ความดัน","เบาหวาน",
    "ถอนฟัน","ผ่าฟันคุด","ทำฟัน","เป็นหวัด","เจ็บคอ","ตั้งครรภ์","หลังคลอด","ให้นม",
    "เวียนหัวหลังบริจาค","หน้ามืดหลังบริจาค","ปวดแขนหลังบริจาค","ผลตรวจ","ผลเลือด","เกล็ดเลือด","donor id","วันเปิด","เวลาเปิด"
  ];
  const picked = known.filter(function(k){ return text.includes(k); });
  const words = text.split(/\s+/).filter(function(w){ return w.length >= 4 && !["บริจาค","โลหิต","เลือด","ไหมคะ","ไหมครับ","หรือไม่","ได้ไหม"].includes(w); });
  words.slice(0,5).forEach(function(w){ if (!picked.includes(w)) picked.push(w); });
  return picked.slice(0,8).join(', ');
}

function resetKnowledgeForm() {
  currentKnowledgeId = null;
  currentKnowledgeSourceQuestionId = null;
  if ($("knowledgeFormTitle")) $("knowledgeFormTitle").innerText = "เพิ่มคำตอบมาตรฐาน";
  if ($("knowledgeQuestion")) $("knowledgeQuestion").value = "";
  if ($("knowledgeAnswer")) $("knowledgeAnswer").value = "";
  if ($("knowledgeCategory")) $("knowledgeCategory").value = "general";
  if ($("knowledgeKeywords")) $("knowledgeKeywords").value = "";
  if ($("knowledgeActive")) $("knowledgeActive").checked = true;
  if ($("knowledgeAutoAnswer")) $("knowledgeAutoAnswer").checked = true;
  if ($("knowledgeHistoryBox")) { $("knowledgeHistoryBox").style.display = "none"; $("knowledgeHistoryBox").innerHTML = ""; }
  if ($("knowledgeEditorCard")) $("knowledgeEditorCard").style.display = "block";
}

function startNewKnowledgeEntry() {
  resetKnowledgeForm();
  $("knowledgeEditorCard")?.scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(function(){ $("knowledgeQuestion")?.focus(); },120);
}

function editKnowledgeEntry(id) {
  const row = staffKnowledgeRows.find(function(x){ return x.id === id; });
  if (!row) return;
  currentKnowledgeId = row.id;
  currentKnowledgeSourceQuestionId = row.source_question_id || null;
  if ($("knowledgeFormTitle")) $("knowledgeFormTitle").innerText = "แก้ไขคำตอบมาตรฐาน";
  if ($("knowledgeQuestion")) $("knowledgeQuestion").value = row.canonical_question || "";
  if ($("knowledgeAnswer")) $("knowledgeAnswer").value = row.answer_text || "";
  if ($("knowledgeCategory")) $("knowledgeCategory").value = row.category || "other";
  if ($("knowledgeKeywords")) $("knowledgeKeywords").value = Array.isArray(row.keywords) ? row.keywords.join(', ') : "";
  if ($("knowledgeActive")) $("knowledgeActive").checked = !!row.is_active;
  if ($("knowledgeAutoAnswer")) $("knowledgeAutoAnswer").checked = !!row.auto_answer_enabled;
  if ($("knowledgeEditorCard")) $("knowledgeEditorCard").style.display = "block";
  loadKnowledgeHistory(row.id);
  $("knowledgeEditorCard")?.scrollIntoView({behavior:"smooth",block:"start"});
}

async function saveKnowledgeEntry() {
  if (!currentStaffProfile) return;
  const question = String($("knowledgeQuestion")?.value || "").trim();
  const answer = String($("knowledgeAnswer")?.value || "").trim();
  const category = $("knowledgeCategory")?.value || "other";
  const keywords = String($("knowledgeKeywords")?.value || "").split(',').map(function(x){ return x.trim(); }).filter(Boolean);
  if (question.length < 3 || answer.length < 3) { showModal({title:"ข้อมูลยังไม่ครบ",message:"กรุณากรอกทั้งคำถามและคำตอบมาตรฐาน",iconText:"!"}); return; }
  const btn = $("knowledgeSaveBtn");
  showBusy(btn,true,currentKnowledgeId ? "บันทึกการแก้ไข" : "เพิ่มเข้าคลัง","กำลังบันทึก...");
  const { data, error } = await sb.rpc("staff_upsert_donor_knowledge", {
    p_id: currentKnowledgeId || null,
    p_question: question,
    p_answer: answer,
    p_category: category,
    p_keywords: keywords,
    p_is_active: !!$("knowledgeActive")?.checked,
    p_auto_answer_enabled: !!$("knowledgeAutoAnswer")?.checked,
    p_source_question_id: currentKnowledgeSourceQuestionId || null
  });
  showBusy(btn,false,currentKnowledgeId ? "บันทึกการแก้ไข" : "เพิ่มเข้าคลัง","กำลังบันทึก...");
  if (error || !data?.ok) { showModal({title:"บันทึกไม่สำเร็จ",message:error?.message || data?.message || "กรุณาลองใหม่",iconText:"!"}); return; }
  donorKnowledgeLoadedAt = 0;
  showToastMessage(currentKnowledgeId ? "อัปเดตคำตอบมาตรฐานแล้ว" : "เพิ่มเข้าคลังคำตอบแล้ว");
  currentKnowledgeId = data.id || currentKnowledgeId;
  await loadStaffKnowledgeBase();
  if (currentKnowledgeId) editKnowledgeEntry(currentKnowledgeId);
}

async function toggleKnowledgeEntry(id, active, autoAnswer) {
  const { data, error } = await sb.rpc("staff_toggle_donor_knowledge", { p_id:id, p_is_active:!!active, p_auto_answer_enabled:!!autoAnswer });
  if (error || !data?.ok) { showModal({title:"ปรับสถานะไม่สำเร็จ",message:error?.message || data?.message || "กรุณาลองใหม่",iconText:"!"}); return; }
  donorKnowledgeLoadedAt = 0;
  await loadStaffKnowledgeBase();
}

async function loadKnowledgeHistory(id) {
  const box = $("knowledgeHistoryBox"); if (!box) return;
  box.style.display = "block";
  box.innerHTML = '<div class="staff-result">กำลังโหลดประวัติ...</div>';
  const { data, error } = await sb.rpc("staff_donor_knowledge_history", { p_id:id, p_limit:20 });
  if (error) { box.innerHTML = '<div class="staff-result fail">โหลดประวัติไม่สำเร็จ<br>' + escapeHtml(error.message) + '</div>'; return; }
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) { box.innerHTML = '<div class="staff-result">ยังไม่มีประวัติการแก้ไข</div>'; return; }
  box.innerHTML = '<div class="knowledge-history-list">' + rows.map(function(r){
    const n = r.new_data || {};
    return '<div class="knowledge-history-item"><div><b>' + escapeHtml(r.action === 'create' ? 'สร้างคำตอบ' : (r.action === 'toggle' ? 'เปลี่ยนสถานะ' : 'แก้ไขคำตอบ')) + '</b><span>' + escapeHtml(r.actor_name || 'เจ้าหน้าที่') + '</span></div><small>' + escapeHtml(formatBangkokLogTime(r.created_at,true)) + '</small>' + (n.answer_text ? '<p>' + escapeHtml(String(n.answer_text).slice(0,180)) + (String(n.answer_text).length>180?'…':'') + '</p>' : '') + '</div>';
  }).join('') + '</div>';
}

async function loadStaffKnowledgeBase() {
  if (!currentStaffProfile) return;
  const list = $("knowledgeList");
  const candidates = $("knowledgeCandidateList");
  if (list) list.innerHTML = '<div class="staff-result">กำลังโหลดคลังคำตอบ...</div>';
  if (candidates) candidates.innerHTML = '<div class="staff-result">กำลังโหลดคำถามที่เคยตอบ...</div>';
  const [{ data:kb, error:kbErr }, { data:answered, error:qErr }] = await Promise.all([
    sb.from("donor_knowledge_base").select("*").order("updated_at",{ascending:false}).limit(200),
    sb.from("donor_questions").select("id,public_code,category,message,last_reply,replied_by_name,replied_at,status").not("last_reply","is",null).order("replied_at",{ascending:false}).limit(60)
  ]);
  if (kbErr) { if (list) list.innerHTML = '<div class="staff-result fail">ยังใช้คลังคำตอบไม่ได้<br>' + escapeHtml(kbErr.message) + '<br><small>หากเพิ่งอัปเดต v15.20 กรุณา Run SQL upgrade ก่อน</small></div>'; return; }
  staffKnowledgeRows = Array.isArray(kb) ? kb : [];
  renderKnowledgeList();
  if (qErr) { if (candidates) candidates.innerHTML = '<div class="staff-result fail">โหลดคำถามเดิมไม่สำเร็จ<br>' + escapeHtml(qErr.message) + '</div>'; return; }
  renderKnowledgeCandidates(Array.isArray(answered) ? answered : []);
}

function renderKnowledgeList() {
  const list = $("knowledgeList"); if (!list) return;
  const query = donorChatNormalizeText($("knowledgeSearch")?.value || "");
  const cat = $("knowledgeFilterCategory")?.value || "all";
  let rows = staffKnowledgeRows.filter(function(r){
    if (cat !== "all" && r.category !== cat) return false;
    if (!query) return true;
    return donorChatNormalizeText((r.canonical_question||"") + " " + (r.answer_text||"") + " " + (Array.isArray(r.keywords)?r.keywords.join(' '):'')).includes(query);
  });
  if ($("knowledgeCountAll")) $("knowledgeCountAll").innerText = staffKnowledgeRows.length;
  if ($("knowledgeCountAuto")) $("knowledgeCountAuto").innerText = staffKnowledgeRows.filter(function(r){return r.is_active && r.auto_answer_enabled;}).length;
  if ($("knowledgeCountPaused")) $("knowledgeCountPaused").innerText = staffKnowledgeRows.filter(function(r){return !r.is_active || !r.auto_answer_enabled;}).length;
  if (!rows.length) { list.innerHTML = '<div class="staff-result">ยังไม่มีคำตอบมาตรฐานในตัวกรองนี้</div>'; return; }
  list.innerHTML = '<div class="knowledge-list">' + rows.map(function(r){
    const active = !!r.is_active;
    const auto = !!r.auto_answer_enabled;
    return '<article class="knowledge-card ' + (!active?'is-paused':'') + '"><div class="knowledge-card-main"><div class="knowledge-card-tags"><span>' + escapeHtml(donorKnowledgeCategoryLabel(r.category)) + '</span>' + (auto&&active?'<b class="kb-auto"><i class="bi bi-stars"></i> ตอบอัตโนมัติ</b>':'<b class="kb-paused">ไม่ตอบอัตโนมัติ</b>') + '</div><h5>' + escapeHtml(r.canonical_question || '') + '</h5><p>' + escapeHtml(String(r.answer_text||'').slice(0,260)) + (String(r.answer_text||'').length>260?'…':'') + '</p><small>แก้ล่าสุด ' + escapeHtml(r.updated_by_name || r.created_by_name || 'เจ้าหน้าที่') + ' · ' + escapeHtml(formatBangkokLogTime(r.updated_at,true)) + '</small></div><div class="knowledge-card-actions"><button type="button" class="btn btn-soft btn-sm" onclick="editKnowledgeEntry(\'' + escapeHtml(r.id) + '\')"><i class="bi bi-pencil-square"></i> แก้ไข</button><button type="button" class="btn btn-outline-secondary btn-sm" onclick="toggleKnowledgeEntry(\'' + escapeHtml(r.id) + '\',' + (!active) + ',' + auto + ')">' + (active?'พักใช้':'เปิดใช้') + '</button><button type="button" class="btn btn-outline-secondary btn-sm" onclick="toggleKnowledgeEntry(\'' + escapeHtml(r.id) + '\',' + active + ',' + (!auto) + ')">' + (auto?'หยุดตอบเอง':'ให้ตอบเอง') + '</button></div></article>';
  }).join('') + '</div>';
}

function renderKnowledgeCandidates(rows) {
  const box = $("knowledgeCandidateList"); if (!box) return;
  const used = new Set(staffKnowledgeRows.map(function(k){return k.source_question_id;}).filter(Boolean));
  const filtered = rows.filter(function(q){ return !used.has(q.id); });
  if (!filtered.length) { box.innerHTML = '<div class="staff-result">คำถามที่ตอบแล้วล่าสุดถูกนำเข้าคลังครบแล้ว หรือยังไม่มีคำถามที่ตอบแล้ว</div>'; return; }
  box.innerHTML = '<div class="knowledge-candidate-list">' + filtered.slice(0,30).map(function(q){
    return '<article class="knowledge-candidate"><div><span>' + escapeHtml(q.public_code || '') + ' · ' + escapeHtml(donorQuestionCategoryLabel(q.category)) + '</span><b>' + escapeHtml(String(q.message||'').slice(0,180)) + '</b><p>' + escapeHtml(String(q.last_reply||'').slice(0,220)) + '</p><small>ตอบโดย ' + escapeHtml(q.replied_by_name || 'เจ้าหน้าที่') + ' · ' + escapeHtml(formatBangkokLogTime(q.replied_at,true)) + '</small></div><button type="button" class="btn btn-soft btn-sm" onclick="prepareKnowledgeFromPastQuestion(\'' + escapeHtml(q.id) + '\')"><i class="bi bi-bookmark-plus"></i> นำเข้าคลัง</button></article>';
  }).join('') + '</div>';
}

async function prepareKnowledgeFromPastQuestion(questionId) {
  const { data:q, error } = await sb.from("donor_questions").select("id,category,message,last_reply").eq("id",questionId).maybeSingle();
  if (error || !q || !q.last_reply) { showModal({title:"นำเข้าไม่ได้",message:error?.message || "ยังไม่พบคำตอบของคำถามนี้",iconText:"!"}); return; }
  resetKnowledgeForm();
  currentKnowledgeSourceQuestionId = q.id;
  $("knowledgeQuestion").value = q.message || "";
  $("knowledgeAnswer").value = q.last_reply || "";
  $("knowledgeCategory").value = knowledgeCategoryFromDonorQuestion(q.category);
  $("knowledgeKeywords").value = knowledgeSuggestedKeywords(q.message || "");
  const medical = ["eligibility","post_donation","test_result"].includes(q.category);
  $("knowledgeAutoAnswer").checked = !medical;
  $("knowledgeEditorCard")?.scrollIntoView({behavior:"smooth",block:"start"});
  showToastMessage(medical ? "นำคำถามมาแล้ว · ตรวจคำตอบก่อนเปิดตอบอัตโนมัติ" : "นำคำถามมาแล้ว · ตรวจแล้วกดบันทึกได้เลย");
}

function addCurrentQuestionToKnowledge() {
  if (!currentStaffQuestion || !currentStaffQuestion.last_reply) { showModal({title:"ยังไม่มีคำตอบ",message:"ต้องส่งคำตอบให้ผู้บริจาคก่อน จึงจะนำคำถามนี้เข้าคลังได้",iconText:"!"}); return; }
  const q = currentStaffQuestion;
  showStaffTab("knowledge");
  setTimeout(function(){
    resetKnowledgeForm();
    currentKnowledgeSourceQuestionId = q.id;
    $("knowledgeQuestion").value = q.message || "";
    $("knowledgeAnswer").value = q.last_reply || "";
    $("knowledgeCategory").value = knowledgeCategoryFromDonorQuestion(q.category);
    $("knowledgeKeywords").value = knowledgeSuggestedKeywords(q.message || "");
    const medical = ["eligibility","post_donation","test_result"].includes(q.category);
    $("knowledgeAutoAnswer").checked = !medical;
    $("knowledgeEditorCard")?.scrollIntoView({behavior:"smooth",block:"start"});
  },180);
}

function base64UrlToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

async function loadPushSubscriptionState() {
  const status = $("pushSupportStatus");
  if (!status) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    status.className = "status-pill danger"; status.innerText = "เครื่องนี้ยังไม่รองรับ"; return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    status.className = "status-pill " + (sub ? "ok" : "neutral");
    status.innerText = sub ? "เปิดแจ้งเตือนแล้ว" : "ยังไม่ได้เปิด";
    if (sub && currentStaffProfile?.user_id) {
      const { data } = await sb.from("push_subscriptions").select("notify_general,notify_doctor").eq("endpoint", sub.endpoint).maybeSingle();
      if (data) {
        if ($("pushNotifyGeneral")) $("pushNotifyGeneral").checked = data.notify_general !== false;
        if ($("pushNotifyDoctor")) $("pushNotifyDoctor").checked = data.notify_doctor === true;
      }
    }
  } catch (err) { status.className = "status-pill danger"; status.innerText = "ตรวจสอบไม่ได้"; }
}

async function enableStaffPushNotifications() {
  if (!currentStaffProfile?.user_id) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    showModal({title:"เครื่องนี้ยังไม่รองรับ",message:"หากใช้ iPhone/iPad ให้เพิ่มเว็บไว้ที่ Home Screen แล้วเปิดจากไอคอนที่ติดตั้งก่อน หากยังไม่ได้ ให้ใช้ Google Chat เป็นช่องแจ้งเตือนหลัก",iconText:"!"}); return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { showModal({title:"ยังไม่ได้อนุญาตแจ้งเตือน",message:"กรุณาอนุญาต Notification ในเครื่องก่อน แล้วลองอีกครั้ง",iconText:"!"}); return; }
    const { data:cfg, error:cfgErr } = await sb.functions.invoke("donor-question-notify", { body:{ action:"config" } });
    if (cfgErr || !cfg?.publicKey) throw new Error("ยังไม่ได้ตั้งค่า VAPID_PUBLIC_KEY ใน Edge Function Secrets");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:base64UrlToUint8Array(cfg.publicKey) });
    const json = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({
      user_id:currentStaffProfile.user_id,
      endpoint:sub.endpoint,
      p256dh:json.keys?.p256dh || "",
      auth:json.keys?.auth || "",
      notify_general:$("pushNotifyGeneral")?.checked !== false,
      notify_doctor:$("pushNotifyDoctor")?.checked === true,
      user_agent:navigator.userAgent
    }, { onConflict:"endpoint" });
    if (error) throw error;
    await loadPushSubscriptionState();
    showModal({title:"เปิดแจ้งเตือนแล้ว",message:$("pushNotifyDoctor")?.checked ? "เครื่องนี้จะรับทั้งคำถามทั่วไปและคำถามที่ต้องให้แพทย์ดู" : "เครื่องนี้จะรับแจ้งเตือนคำถามทั่วไป",iconText:"✓"});
  } catch (err) {
    showModal({title:"เปิดแจ้งเตือนไม่สำเร็จ",message:err.message || String(err),iconText:"!"});
  }
}


async function getSessionAccessToken() {
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : "";
}

async function callAdminStaffFunction(action, payload) {
  const token = await getSessionAccessToken();
  if (!token) return { data:null, error:new Error("ไม่พบ session เจ้าหน้าที่ กรุณาเข้าสู่ระบบใหม่") };

  const body = Object.assign({ action: action }, payload || {});
  const { data, error } = await sb.functions.invoke("admin-staff", {
    body: body,
    headers: { Authorization: "Bearer " + token }
  });

  return { data, error };
}

function getAdminStaffFormValues() {
  return {
    email: normalizeStaffEmail($("adminStaffEmail").value),
    display_name: String($("adminStaffDisplayName").value || "").trim(),
    role: $("adminStaffRole").value || "staff",
    is_active: String($("adminStaffActive") ? $("adminStaffActive").value : "true") === "true",
    temporary_password: String($("adminTempPassword") ? $("adminTempPassword").value : "").trim()
  };
}

function validateAdminStaffBase(form, box) {
  if (!form.email || !form.display_name) {
    setStaffResult(box, "กรุณากรอก Email และชื่อที่แสดง", false);
    return false;
  }
  if (!isAllowedStaffEmail(form.email)) {
    setStaffResult(box, "กรุณาใช้ email @" + (CONFIG.STAFF_EMAIL_DOMAIN || "mahidol.ac.th"), false);
    return false;
  }
  return true;
}

async function adminCreateOrResetStaff() {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return;

  const form = getAdminStaffFormValues();
  const btn = $("btnAdminCreateStaff");
  const box = $("adminStaffResult");

  if (!validateAdminStaffBase(form, box)) return;
  if (!form.temporary_password || form.temporary_password.length < 8) {
    setStaffResult(box, "กรุณาตั้งรหัสผ่านชั่วคราวอย่างน้อย 8 ตัวอักษร", false);
    return;
  }

  const normalBtnText = (btn && btn.dataset && btn.dataset.normalText) ? btn.dataset.normalText : "สร้าง/รีเซตบัญชี + ตั้งรหัสชั่วคราว";

  showBusy(btn, true, normalBtnText, "กำลังบันทึก...");
  const { data, error } = await callAdminStaffFunction("upsert_staff_temp_password", form);
  showBusy(btn, false, normalBtnText, "กำลังบันทึก...");

  if (error || !data || data.ok !== true) {
    setStaffResult(box, "บันทึกไม่สำเร็จ\n" + (error?.message || data?.message || "ไม่สามารถบันทึกได้"), false);
    return;
  }

  setStaffResult(
    box,
    "บันทึกสำเร็จ\n\n" +
    "Email: " + form.email + "\n" +
    "ชื่อ: " + form.display_name + "\n" +
    "สิทธิ์: " + form.role + "\n" +
    "สถานะ: " + (form.is_active ? "เปิดใช้" : "ปิดสิทธิ์") + "\n\n" +
    "ให้น้องเข้าสู่ระบบด้วยรหัสผ่านชั่วคราว แล้วระบบจะบังคับเปลี่ยนรหัสผ่านเองทันที",
    true
  );

  if ($("adminTempPassword")) $("adminTempPassword").value = "";
  adminLoadStaffAccessList();
}

async function adminUpdateStaffStatusOnly() {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return;

  const form = getAdminStaffFormValues();
  const btn = $("btnAdminSaveStatus");
  const box = $("adminStaffResult");

  if (!validateAdminStaffBase(form, box)) return;

  showBusy(btn, true, "บันทึกชื่อ/สิทธิ์/สถานะอย่างเดียว", "กำลังบันทึก...");
  const { data, error } = await callAdminStaffFunction("update_staff_status", form);
  showBusy(btn, false, "บันทึกชื่อ/สิทธิ์/สถานะอย่างเดียว", "กำลังบันทึก...");

  if (error || !data || data.ok !== true) {
    setStaffResult(box, "บันทึกไม่สำเร็จ\n" + (error?.message || data?.message || "ไม่สามารถบันทึกได้"), false);
    return;
  }

  setStaffResult(box, "บันทึกชื่อ/สิทธิ์/สถานะสำเร็จ", true);
  adminLoadStaffAccessList();
}

function setStaffNotice(box, text) {
  if (!box) return;
  box.style.display = "block";
  box.className = "staff-result mt-3";
  box.innerText = text;
}

function setAdminStaffPrimaryButtonText(text) {
  const btn = $("btnAdminCreateStaff");
  if (!btn) return;
  btn.innerText = text;
  btn.dataset.normalText = text;
}

function adminGenerateTempPassword() {
  const input = $("adminTempPassword");
  if (!input) return "";

  let num = Math.floor(Math.random() * 900000) + 100000;
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    num = 100000 + (arr[0] % 900000);
  }

  const password = "Cnmi@" + String(num);
  input.value = password;
  input.focus();
  input.select();
  return password;
}

async function adminCopyTempPassword() {
  const input = $("adminTempPassword");
  const box = $("adminStaffResult");
  const password = String(input ? input.value : "").trim();

  if (!password) {
    setStaffNotice(box, `ยังไม่มีรหัสผ่านชั่วคราวให้คัดลอก
ให้กรอกเอง หรือกดปุ่ม สุ่ม ก่อน`);
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(password);
      setStaffNotice(box, `คัดลอกรหัสผ่านชั่วคราวแล้ว
นำไปแจ้งน้องเจ้าหน้าที่ได้เลย`);
    } else {
      input.focus();
      input.select();
      setStaffNotice(box, `เลือกข้อความรหัสผ่านไว้ให้แล้ว
กด Ctrl+C เพื่อคัดลอก`);
    }
  } catch (err) {
    input.focus();
    input.select();
    setStaffNotice(box, `คัดลอกอัตโนมัติไม่ได้
กด Ctrl+C เพื่อคัดลอกจากช่องรหัสผ่านชั่วคราว`);
  }
}

function adminFillStaffForm(email, displayName, role, isActive) {
  if ($("adminStaffEmail")) $("adminStaffEmail").value = staffEmailLocalPart(email || "");
  if ($("adminStaffDisplayName")) $("adminStaffDisplayName").value = displayName || "";
  if ($("adminStaffRole")) $("adminStaffRole").value = role || "staff";
  if ($("adminStaffActive")) $("adminStaffActive").value = isActive ? "true" : "false";
  setAdminStaffPrimaryButtonText("สร้าง/รีเซตบัญชี + ตั้งรหัสชั่วคราว");
  const box = $("adminStaffResult");
  setStaffNotice(box, `เลือกข้อมูลเจ้าหน้าที่แล้ว
ถ้าต้องการแก้เฉพาะชื่อ/สิทธิ์/สถานะ ให้กดปุ่มสีเทา
ถ้าต้องการตั้งหรือรีเซตรหัส ให้ใส่รหัสชั่วคราว แล้วกดปุ่มสีแดง`);
  const card = $("adminStaffFormCard");
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior:"smooth", block:"start" });
}

function adminPreparePasswordForm(email, displayName, role, isActive, hasAuthUser) {
  adminFillStaffForm(email, displayName, role, isActive);

  const actionText = hasAuthUser
    ? "รีเซตรหัสผ่านชั่วคราว"
    : "สร้างบัญชี + ตั้งรหัสชั่วคราว";

  setAdminStaffPrimaryButtonText(actionText);

  const password = adminGenerateTempPassword();
  const box = $("adminStaffResult");
  setStaffNotice(
    box,
    `เลือกเจ้าหน้าที่: ${email || "-"}
งานที่จะทำ: ${actionText}

ระบบสุ่มรหัสชั่วคราวไว้ให้แล้ว: ${password}
ตรวจชื่อ/สิทธิ์/สถานะอีกครั้ง แล้วกดปุ่มสีแดงเพื่อบันทึกจริง
หลังจากนั้นให้น้อง login ด้วยรหัสนี้ แล้วระบบจะบังคับเปลี่ยนรหัสผ่านเอง`
  );
}

async function adminSetActive(email, displayName, role, isActive) {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return;

  const box = $("adminStaffResult");
  const { data, error } = await callAdminStaffFunction("update_staff_status", {
    email: email,
    display_name: displayName || email,
    role: role || "staff",
    is_active: !!isActive
  });

  if (error || !data || data.ok !== true) {
    setStaffResult(box, "ปรับสถานะไม่สำเร็จ\n" + (error?.message || data?.message || "ไม่สามารถบันทึกได้"), false);
    return;
  }

  setStaffResult(box, (isActive ? "เปิดใช้สิทธิ์แล้ว" : "ปิดสิทธิ์แล้ว") + "\n" + email, true);
  adminLoadStaffAccessList();
}

async function adminLoadStaffAccessList() {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return;

  const box = $("adminStaffList");
  if (!box) return;
  box.innerHTML = "กำลังโหลดรายชื่อ...";

  const { data, error } = await sb.rpc("admin_list_staff_access");
  if (error) {
    box.className = "staff-result fail";
    box.innerText = "โหลดรายชื่อไม่สำเร็จ\n" + error.message;
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    box.className = "staff-result";
    box.innerText = "ยังไม่มีรายชื่อเจ้าหน้าที่";
    return;
  }

  box.className = "table-responsive";
  box.innerHTML = '<table class="table table-sm preview-table staff-access-table"><thead><tr><th>Email</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>บัญชี</th><th>รหัส</th><th>จัดการ</th><th>เปิด/ปิด</th></tr></thead><tbody>' +
    rows.map(function(r) {
      const email = escapeHtml(r.email || '');
      const name = escapeHtml(r.display_name || '');
      const role = escapeHtml(r.role || 'staff');
      const activeText = r.is_active ? 'เปิดใช้' : 'ปิดสิทธิ์';
      const accountText = r.has_auth_user ? 'มีบัญชีแล้ว' : 'ยังไม่มีบัญชี';
      const passText = r.must_change_password ? 'รอเปลี่ยนรหัส' : 'ปกติ';
      const passwordBtnText = r.has_auth_user ? 'รีเซตรหัส' : 'สร้างบัญชี';
      const passwordBtnClass = r.has_auth_user ? 'btn-outline-warning' : 'btn-outline-primary';
      const safeEmailArg = JSON.stringify(r.email || '');
      const safeNameArg = JSON.stringify(r.display_name || '');
      const safeRoleArg = JSON.stringify(r.role || 'staff');
      return '<tr>' +
        '<td data-label="Email">' + email + '</td>' +
        '<td data-label="ชื่อ">' + name + '</td>' +
        '<td data-label="สิทธิ์">' + role + '</td>' +
        '<td data-label="สถานะ">' + activeText + '</td>' +
        '<td data-label="บัญชี">' + accountText + '</td>' +
        '<td data-label="รหัส">' + passText + '</td>' +
        '<td data-label="จัดการ" class="text-nowrap">' +
          '<button type="button" class="btn btn-sm ' + passwordBtnClass + ' fw-bold me-1" onclick="adminPreparePasswordForm(' + safeEmailArg + ',' + safeNameArg + ',' + safeRoleArg + ',' + (r.is_active ? 'true' : 'false') + ',' + (r.has_auth_user ? 'true' : 'false') + ')">' + passwordBtnText + '</button>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" onclick="adminFillStaffForm(' + safeEmailArg + ',' + safeNameArg + ',' + safeRoleArg + ',' + (r.is_active ? 'true' : 'false') + ')">แก้ข้อมูล</button>' +
        '</td>' +
        '<td data-label="เปิด/ปิด" class="text-nowrap">' +
          '<button type="button" class="btn btn-sm ' + (r.is_active ? 'btn-outline-danger' : 'btn-outline-success') + '" onclick="adminSetActive(' + safeEmailArg + ',' + safeNameArg + ',' + safeRoleArg + ',' + (r.is_active ? 'false' : 'true') + ')">' + (r.is_active ? 'ปิดสิทธิ์' : 'เปิดใช้') + '</button>' +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}

function initConfigText() {
  if ($("orgTitle")) $("orgTitle").innerText = CONFIG.ORG_TITLE || "CNMI Blood Donation";
  if ($("orgSubtitle")) $("orgSubtitle").innerText = CONFIG.ORG_SUBTITLE || "ห้องรับบริจาคโลหิต รามาธิบดีจักรีนฤบดินทร";
  if ($("contactPhone")) { $("contactPhone").innerText = CONFIG.PHONE_TEXT || "02-839-6050"; $("contactPhone").href = "tel:" + (CONFIG.PHONE_TEL || "028396050"); }
  if ($("notFoundTel")) { $("notFoundTel").innerText = "📞 โทรสอบถาม: " + (CONFIG.PHONE_TEXT || "02-839-6050"); $("notFoundTel").href = "tel:" + (CONFIG.PHONE_TEL || "028396050"); }
  if ($("mapLink")) $("mapLink").href = CONFIG.MAP_URL || "#";
}

function initInputs() {
  const today = todayISO();

  ["donorDobCheck", "donorDobForgot"].forEach(id => {
    const input = $(id);
    if (!input) return;
    input.addEventListener("blur", () => formatDobInputOnBlur(input));
    input.addEventListener("input", () => {
      input.value = formatDobInputWhileTyping(input.value);
    });
  });

  ["phoneLast4Check", "phoneLast4Forgot"].forEach(id => {
    const input = $(id);
    if (input) input.addEventListener("input", () => input.value = onlyDigits(input.value).slice(0,10));
  });

  ["managePhoneLast4"].forEach(id => {
    const input = $(id);
    if (input) input.addEventListener("input", () => input.value = onlyDigits(input.value).slice(0,4));
  });

  ["bookingPhone"].forEach(id => {
    const input = $(id); if (input) input.addEventListener("input", () => input.value = onlyDigits(input.value).slice(0,10));
  });
  const bookingDate = $("bookingDate");
  if (bookingDate) {
    const tomorrow = addDaysISO(today, 1);
    bookingDate.min = tomorrow;
    bookingDate.max = addMonthsISO(today, 1);
    bookingDate.addEventListener("change", loadBookingSlots);
  }
  ["bookingEmail","groupEmail","mobileUnitEmail"].forEach(id => {
    const input = $(id);
    if (input) input.addEventListener("input", () => { input.value = String(input.value || "").replace(/\s/g, "").toLowerCase(); });
  });
  const groupPhone = $("groupPhone"); if (groupPhone) groupPhone.addEventListener("input", () => groupPhone.value = onlyDigits(groupPhone.value).slice(0,10));
  const mobileUnitPhone = $("mobileUnitPhone"); if (mobileUnitPhone) mobileUnitPhone.addEventListener("input", () => mobileUnitPhone.value = onlyDigits(mobileUnitPhone.value).slice(0,10));
  const mobileUnitDate = $("mobileUnitDate"); if (mobileUnitDate) { mobileUnitDate.min = addDaysISO(today, 1); }
  const bookingListDate = $("bookingListDate"); if (bookingListDate) bookingListDate.value = today;
  const groupListFrom = $("groupListFrom"); if (groupListFrom) groupListFrom.value = today;
  const mobileUnitListFrom = $("mobileUnitListFrom"); if (mobileUnitListFrom) mobileUnitListFrom.value = today;
  const importLogDate = $("importLogDate"); if (importLogDate) importLogDate.value = today;

  const groupPublicMonth = $("groupPublicMonth");
  if (groupPublicMonth) {
    groupPublicMonth.value = currentMonthValue();
    groupPublicMonth.min = currentMonthValue();
    groupPublicMonth.max = nextMonthValue();
    groupPublicMonth.addEventListener("change", function(){
      if ($("groupDate")) $("groupDate").value = "";
      const display = $("groupSelectedDate");
      if (display) {
        display.classList.remove("selected");
        display.innerHTML = '<i class="bi bi-calendar-check"></i><span>กรุณาเลือกวันที่จากตารางด้านบน</span>';
      }
      loadGroupPublicCalendar(false);
    });
  }

  const publicRoomMonth = $("publicRoomMonth");
  if (publicRoomMonth) {
    publicRoomMonth.value = currentMonthValue();
    publicRoomMonth.min = currentMonthValue();
    publicRoomMonth.max = futureMonthValue(24);
    publicRoomMonth.addEventListener("change", function(){ loadPublicRoomCalendar(false); });
  }

  const plateletMonth = $("plateletMonth");
  if (plateletMonth) {
    plateletMonth.value = currentMonthValue();
    plateletMonth.min = currentMonthValue();
    plateletMonth.max = nextMonthValue();
    plateletMonth.addEventListener("change", function(){
      const r = monthRange(plateletMonth.value);
      if ($("plateletCloseDate") && r) { $("plateletCloseDate").min = r.start > today ? r.start : today; $("plateletCloseDate").max = r.end; $("plateletCloseDate").value = ""; }
      loadPlateletMonthAdmin();
    });
  }
  const plateletCloseDate = $("plateletCloseDate");
  if (plateletCloseDate) {
    const r = monthRange(plateletMonth?.value || currentMonthValue());
    plateletCloseDate.min = today;
    if (r) plateletCloseDate.max = r.end;
  }

  const groupAdminMonth = $("groupAdminMonth");
  if (groupAdminMonth) {
    groupAdminMonth.value = currentMonthValue();
    groupAdminMonth.min = currentMonthValue();
    groupAdminMonth.max = nextMonthValue();
    groupAdminMonth.addEventListener("change", function(){
      const r = monthRange(groupAdminMonth.value);
      if ($("groupAdminDate") && r) {
        $("groupAdminDate").min = r.start > today ? r.start : today;
        $("groupAdminDate").max = r.end;
        $("groupAdminDate").value = "";
      }
      loadGroupBookingMonthAdmin();
    });
  }
  const groupAdminDate = $("groupAdminDate");
  if (groupAdminDate) {
    const r = monthRange(groupAdminMonth?.value || currentMonthValue());
    groupAdminDate.min = today;
    if (r) groupAdminDate.max = r.end;
  }

  const roomAdminMonth = $("roomAdminMonth");
  if (roomAdminMonth) {
    roomAdminMonth.value = currentMonthValue();
    roomAdminMonth.min = currentMonthValue();
    roomAdminMonth.max = futureMonthValue(24);
    roomAdminMonth.addEventListener("change", function(){
      const r = monthRange(roomAdminMonth.value);
      if ($("roomEventDate") && r) {
        $("roomEventDate").min = r.start;
        $("roomEventDate").max = r.end;
        $("roomEventDate").value = "";
      }
      loadRoomCalendarAdmin();
    });
  }
  const roomEventDate = $("roomEventDate");
  if (roomEventDate) {
    const r = monthRange(roomAdminMonth?.value || currentMonthValue());
    if (r) { roomEventDate.min = r.start; roomEventDate.max = r.end; }
  }

  ["staffEmail", "adminStaffEmail"].forEach(id => {
    const input = $(id);
    if (!input) return;

    input.addEventListener("input", () => {
      input.value = String(input.value || "").toLowerCase().replace(/\s/g, "");
    });

    input.addEventListener("blur", () => {
      input.value = staffEmailLocalPart(input.value);
    });
  });

  const donorImportFile = $("donorImportFile");
  if (donorImportFile) donorImportFile.addEventListener("change", resetDonorImportState);
}

function initMobileViewportPolish() {
  const ua = String(navigator.userAgent || "");
  const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  document.body.classList.toggle("platform-ios", isiOS);
  document.body.classList.toggle("platform-android", isAndroid);

  const syncViewport = function() {
    const vv = window.visualViewport;
    const viewportHeight = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-viewport-height", viewportHeight + "px");

    const keyboardDelta = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
    const keyboardOpen = window.innerWidth <= 700 && keyboardDelta > 140;
    document.body.classList.toggle("keyboard-open", keyboardOpen);
  };

  syncViewport();
  window.addEventListener("resize", syncViewport, { passive: true });
  window.addEventListener("orientationchange", function() {
    setTimeout(syncViewport, 120);
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewport, { passive: true });
    window.visualViewport.addEventListener("scroll", syncViewport, { passive: true });
  }

  document.addEventListener("focusin", function(event) {
    const el = event.target;
    if (!el || !el.matches || !el.matches("input, textarea, select")) return;
    document.body.classList.add("input-focused");
    if (window.innerWidth <= 700) {
      setTimeout(function() {
        try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (err) {}
      }, 220);
    }
  });

  document.addEventListener("focusout", function() {
    setTimeout(function() {
      if (!document.activeElement || !document.activeElement.matches || !document.activeElement.matches("input, textarea, select")) {
        document.body.classList.remove("input-focused");
        syncViewport();
      }
    }, 80);
  });
}

function initPwaShell() {
  const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = window.navigator && window.navigator.standalone === true;
  if (standalone || iosStandalone) document.body.classList.add("is-standalone");

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function() {
      navigator.serviceWorker.register("service-worker.js?v=15.22").catch(function(err) {
        console.warn("Service worker registration failed", err);
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", async function() {
  initConfigText();
  initInputs();
  initMobileViewportPolish();
  initPwaShell();
  updateMobileNav("home");

  const hashText = String(window.location.hash || "") + " " + String(window.location.search || "");
  if (pendingPasswordRecovery || hashText.includes("type=recovery")) {
    showPage("staffChangePassword", { replaceRoute:true });
    return;
  }

  if (!window.location.hash) {
    history.replaceState({ cnmiRoute:"#/home" }, "", "#/home");
  }
  ["donorChatStepInput","donorChatStepTextarea"].forEach(function(id){
    const el = $(id);
    if (!el) return;
    el.addEventListener("keydown", function(ev){
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        submitDonorChatStep();
      }
    });
  });
  const follow = $("donorChatFollowupText");
  if (follow) follow.addEventListener("keydown", function(ev){
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); sendDonorQuestionFollowup(); }
  });
  await handleHashRoute();
});

window.addEventListener("hashchange", function() { handleHashRoute(); });
window.addEventListener("popstate", function() { handleHashRoute(); });


document.addEventListener("keydown", function(event){
  if (event.key === "Escape") closeStaffMenuLauncher();
});
