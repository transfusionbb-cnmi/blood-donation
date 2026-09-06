/* CNMI Blood Donation Supabase Frontend v15.2 */

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
let currentGroupAdminDays = [];
let currentRoomAdminEvents = [];
let currentPublicRoomEvents = [];
let pendingStaffRouteTab = "overview";
let suppressRouteSync = false;

const PAGE_ROUTE_MAP = {
  home: "#/home",
  check: "#/check",
  donationChoice: "#/donate",
  screening: "#/platelet/screening",
  booking: "#/platelet/booking",
  bookingSuccess: "#/platelet/success",
  groupBooking: "#/group-booking",
  mobileUnitRequest: "#/mobile-unit",
  manage: "#/manage",
  roomCalendar: "#/calendar",
  info: "#/contact",
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
  slots: "platelet-calendar",
  bookings: "platelet-bookings",
  groupSlots: "group-calendar",
  groups: "group-requests",
  mobileUnits: "mobile-unit-requests",
  roomCalendar: "room-calendar",
  admin: "admin"
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
  const path = hash.split("?")[0].replace(/^#\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!path) return { page:"home" };
  const map = {
    home:"home", check:"check", donate:"donationChoice", "group-booking":"groupBooking",
    "mobile-unit":"mobileUnitRequest", manage:"manage", calendar:"roomCalendar", contact:"info"
  };
  if (map[path]) return { page:map[path] };
  if (path === "platelet/screening") return { page:"screening" };
  if (path === "platelet/booking") return { page:"booking" };
  if (path === "platelet/success") return { page:"bookingSuccess" };
  if (path === "staff" || path.startsWith("staff/")) {
    const part = path.split("/")[1] || "overview";
    if (part === "login") return { page:"staffLogin", staff:true };
    if (part === "password") return { page:"staffChangePassword", staff:true };
    return { page:"staff", staff:true, tab:tabFromRoutePart(part) };
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
    if (route.page === "staffLogin") { suppressRouteSync = true; showPage("staffLogin"); suppressRouteSync = false; return; }
    if (route.page === "staffChangePassword") { suppressRouteSync = true; showPage("staffChangePassword"); suppressRouteSync = false; return; }
    await showStaffGate();
    if (currentStaffProfile) showStaffTab(pendingStaffRouteTab, { skipRoute:true });
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

const screeningQuestions = [
  { text:"ท่านนอนหลับพักผ่อนเพียงพอหรือไม่ อย่างน้อยประมาณ 5 ชั่วโมง", passAnswer:"yes", failMessage:"ท่านควรพักผ่อนให้เพียงพอก่อนบริจาคโลหิต" },
  { text:"ภายใน 4 ชั่วโมงที่ผ่านมา ท่านได้รับประทานอาหารมาแล้วหรือไม่", passAnswer:"yes", failMessage:"แนะนำให้รับประทานอาหารก่อนมาบริจาคโลหิต และหลีกเลี่ยงอาหารไขมันสูง" },
  { text:"ขณะนี้ท่านรู้สึกสบายดี ไม่มีไข้ ไอ เจ็บคอ หรืออาการเจ็บป่วยชัดเจน ใช่หรือไม่", passAnswer:"yes", failMessage:"หากมีอาการไม่สบาย แนะนำให้พักผ่อนก่อน และติดต่อเจ้าหน้าที่หากต้องการสอบถามเพิ่มเติม" },
  { text:"ช่วงนี้ท่านมีแผลอักเสบ ติดเชื้อ หรืออยู่ระหว่างรับประทานยาปฏิชีวนะหรือไม่", passAnswer:"no", failMessage:"กรุณาติดต่อเจ้าหน้าที่ก่อนจองคิว เพื่อประเมินความพร้อมในการบริจาคโลหิต" },
  { text:"ในช่วง 7 วันที่ผ่านมา ท่านถอนฟัน ผ่าฟันคุด หรือทำหัตถการทางทันตกรรมหรือไม่", passAnswer:"no", failMessage:"กรุณาติดต่อเจ้าหน้าที่เพื่อประเมินระยะเวลาที่เหมาะสมก่อนบริจาคโลหิต" },
  { text:"สำหรับผู้หญิง: ท่านกำลังตั้งครรภ์ หลังคลอด หรืออยู่ระหว่างให้นมบุตรหรือไม่", passAnswer:"no", gender:"หญิง", failMessage:"กรุณาติดต่อเจ้าหน้าที่ก่อนจองคิว เพื่อประเมินความพร้อมในการบริจาคโลหิต" }
];

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
    home:"pageHome", check:"pageCheck", donationChoice:"pageDonationChoice", groupBooking:"pageGroupBooking",
    mobileUnitRequest:"pageMobileUnitRequest",
    screening:"pageScreening", booking:"pageBooking", bookingSuccess:"pageBookingSuccess", manage:"pageManage",
    roomCalendar:"pageRoomCalendar", info:"pageInfo",
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
  if (page === "groupBooking") {
    setTimeout(loadGroupPublicCalendar, 40);
  }
  if (page === "roomCalendar") {
    setTimeout(loadPublicRoomCalendar, 40);
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
      copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>เปิดทำการตามปกติ</b><span>วันที่ไม่มีประกาศพิเศษถือว่าเปิดทำการ</span>';
      if (icon) icon.className = "bi bi-check-circle";
      return;
    }
    const meta = roomEventMeta(e.type);
    const closed = e.type === "closed" || e.type === "mobile_unit";
    box.className = "home-room-status mb-3 " + (closed ? "status-closed" : (e.type === "limited" ? "status-limited" : "status-open"));
    const details = [e.title && e.title !== meta.label ? e.title : "", e.time, e.location].filter(Boolean).join(" · ");
    copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>' + escapeHtml(meta.label) + '</b><span>' + escapeHtml(details || e.note || (closed ? "กรุณาดูรายละเอียดในปฏิทิน" : "เปิดให้บริการตามประกาศ")) + '</span>';
    if (icon) icon.className = "bi " + meta.icon;
  } catch (err) {
    box.className = "home-room-status mb-3 status-neutral";
    copy.innerHTML = '<small>สถานะห้องบริจาควันนี้</small><b>ตรวจสอบไม่ได้ชั่วคราว</b><span>กดดูปฏิทินหรือติดต่อเจ้าหน้าที่</span>';
  }
}

function showDonationChoice() {
  showPage("donationChoice");
}
function startPlateletScreening() { showPage("screening"); resetScreening(); }
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

function showStaffTab(tab, options) {
  options = options || {};
  if (tab === "admin" && !isAdminView()) {
    showModal({ title:"ไม่มีสิทธิ์ Admin ในมุมมองนี้", message:"หากเป็น Admin กรุณากด “กลับ Admin” ก่อน", iconText:"!" });
    return;
  }
  document.querySelectorAll(".staff-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.staffTab === tab));
  document.querySelectorAll(".staff-tab-page").forEach(page => page.classList.remove("active"));
  const target = $("staffTab_" + tab);
  if (target) target.classList.add("active");
  pendingStaffRouteTab = tab || "overview";
  if (!options.skipRoute && !suppressRouteSync) {
    const route = "#/staff/" + (STAFF_TAB_ROUTE_MAP[tab] || "overview");
    if (window.location.hash !== route) history.pushState({ cnmiRoute:route }, "", route);
  }
  if (tab === "overview") loadStaffDashboard();
  if (tab === "importLogs") loadImportLogHistory(1);
  if (tab === "notifications") loadStaffNotifications();
  if (tab === "slots") loadPlateletMonthAdmin();
  if (tab === "bookings") loadStaffBookings();
  if (tab === "groupSlots") loadGroupBookingMonthAdmin();
  if (tab === "groups") loadStaffGroupRequests();
  if (tab === "mobileUnits") loadStaffMobileUnitRequests();
  if (tab === "roomCalendar") loadRoomCalendarAdmin();
  if (tab === "admin") adminLoadStaffAccessList();
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
  const result = { file:"", sheet:"", mode:"", other:"" };
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

function renderImportLogCards(rows, options) {
  options = options || {};
  if (!rows || rows.length === 0) {
    return '<div class="log-empty"><i class="bi bi-inbox"></i><span>' + escapeHtml(options.emptyText || "ยังไม่มีกิจกรรมนำเข้าในวันที่เลือก") + '</span></div>';
  }
  return '<div class="friendly-log-list">' + rows.map(function(r) {
    const info = parseImportLogMessage(r.message);
    const fileLine = info.file ? '<div class="friendly-log-file"><i class="bi bi-file-earmark-spreadsheet"></i><span>' + escapeHtml(info.file) + '</span></div>' : '';
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
      fileLine + sheetLine + systemDetails +
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
      .select("import_type, imported_count, skipped_count, message, created_at")
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
    .select("import_type, imported_count, skipped_count, message, created_at", { count:"exact" })
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

    if (importBtn) importBtn.disabled = false;
    setStaffResult(previewBox,
      "ตรวจไฟล์เรียบร้อย รอยืนยันนำเข้า\n\n" +
      "ชื่อไฟล์: " + file.name + "\n" +
      "โหมดไฟล์: " + (parsed.mode || "-") + "\n" +
      "พร้อมส่งเข้า Supabase: " + ready + " รายการ\n" +
      "ข้าม เพราะไม่มี Unit No: " + (parsed.skippedNoUnit || 0) + " รายการ\n" +
      "ข้าม เพราะบริจาคไม่ได้: " + (parsed.skippedCannotDonate || 0) + " รายการ\n" +
      "ข้าม เพราะข้อมูลสำคัญไม่ครบ: " + (parsed.skippedMissing || 0) + " รายการ\n" +
      "ข้อมูลซ้ำในไฟล์เดียวกัน: " + deduped.duplicateInFile + " รายการ\n\n" +
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

  const parsed = pendingDonorImport.parsed || {};
  const records = pendingDonorImport.records;
  const fileName = pendingDonorImport.fileName || "";

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

    await sb.from("import_logs").insert({
      import_type: "donor_import",
      imported_count: records.length,
      skipped_count: (parsed.skippedNoUnit || 0) + (parsed.skippedCannotDonate || 0) + (parsed.skippedMissing || 0) + (pendingDonorImport.duplicateInFile || 0),
      message: `mode=${parsed.mode || "-"}, file=${fileName}`
    });

    setStaffResult(box,
      "นำเข้าข้อมูลผู้บริจาคเสร็จแล้ว\n\n" +
      "ชื่อไฟล์: " + fileName + "\n" +
      "โหมดไฟล์: " + (parsed.mode || "-") + "\n" +
      "ส่งเข้า Supabase: " + sent + " รายการ\n" +
      "ข้าม เพราะไม่มี Unit No: " + (parsed.skippedNoUnit || 0) + " รายการ\n" +
      "ข้าม เพราะบริจาคไม่ได้: " + (parsed.skippedCannotDonate || 0) + " รายการ\n" +
      "ข้าม เพราะข้อมูลสำคัญไม่ครบ: " + (parsed.skippedMissing || 0) + " รายการ\n" +
      "ข้อมูลซ้ำในไฟล์เดียวกัน: " + (pendingDonorImport.duplicateInFile || 0) + " รายการ\n\n" +
      "หมายเหตุ: ข้อมูลที่ซ้ำกับฐานข้อมูลเดิมจะไม่เพิ่มซ้ำจาก key Donor ID + วันที่บริจาค + ชนิดบริจาค",
      true
    );

    pendingDonorImport = null;
    if (btn) btn.disabled = true;
    if (previewBox) previewBox.style.display = "none";
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
      message: `sheet=${parsed.sheetName}, file=${file.name}`
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

function calendarSlotHtml(slot, used) {
  if (!slot) return '<div class="platelet-slot-mini missing"><b>-</b><span>ยังไม่เตรียม</span></div>';
  const time = String(slot.time_slot || "").slice(0,5);
  const closed = slot.status === "ปิด";
  return '<div class="platelet-slot-mini ' + (closed ? 'closed' : '') + '"><b>' + escapeHtml(time) + '</b><span>' + (closed ? 'งดรับ' : escapeHtml(String(used || 0)) + '/' + escapeHtml(String(slot.max_queue || 2))) + '</span></div>';
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
      html += '<button type="button" class="platelet-day-cell weekday ' + (bothClosed ? 'day-closed' : '') + '" onclick="selectPlateletAdminDate(\''+iso+'\')">' +
        '<div class="platelet-day-number">'+day+'</div>' +
        '<div class="platelet-mini-grid">' + calendarSlotHtml(sm['09:00'], usedMap[iso+'|09:00']) + calendarSlotHtml(sm['13:00'], usedMap[iso+'|13:00']) + '</div>' +
        '</button>';
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
    return;
  }
  if (!data || data.length === 0) {
    box.innerHTML = '<div class="staff-result">ไม่พบรายการจองเกล็ดเลือดในวันนี้</div>';
    return;
  }
  box.innerHTML = '<table class="table table-sm preview-table mobile-card-table"><thead><tr><th>เวลา</th><th>เลขนัด</th><th>ชื่อ</th><th>โทร / อีเมล</th><th>Donor ID</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>' +
    data.map(r => {
      const safeId = String(r.booking_id || "").replace(/'/g, "\\'");
      const statusClass = r.status === 'ต้องติดต่อ' ? 'booking-status-contact' : (r.status === 'ยกเลิก' ? 'booking-status-cancel' : 'booking-status-ok');
      const actions = r.status === 'ต้องติดต่อ'
        ? "<button type='button' class='btn btn-sm btn-outline-success me-1' onclick=\"staffSetPlateletBookingStatus('" + safeId + "','จองแล้ว')\">ยืนยันคิว</button><button type='button' class='btn btn-sm btn-outline-danger' onclick=\"staffSetPlateletBookingStatus('" + safeId + "','ยกเลิก')\">ยกเลิก</button>"
        : '-';
      return '<tr>' +
        '<td data-label="เวลา">' + escapeHtml(String(r.time_slot).slice(0,5)) + '</td>' +
        '<td data-label="เลขนัด">' + escapeHtml(r.public_code || r.booking_id || '') + '</td>' +
        '<td data-label="ชื่อ">' + escapeHtml(r.full_name) + '</td>' +
        '<td data-label="ติดต่อ"><a href="tel:' + escapeHtml(r.phone) + '">' + escapeHtml(r.phone) + '</a>' + (r.email ? '<br><a class="mail-link-btn" href="' + escapeHtml(buildMailtoHref(r.email, 'CNMI Blood Donation — นัดบริจาคเกล็ดเลือด', 'เรียน ' + (r.full_name || '') + '\n\nเกี่ยวกับนัดบริจาคเกล็ดเลือด เลขนัด ' + (r.public_code || r.booking_id || '') + '\nวันที่ ' + isoToThaiDate(r.booking_date, true) + ' เวลา ' + String(r.time_slot).slice(0,5) + ' น.\n\nห้องบริจาคโลหิต CNMI')) + '"><i class="bi bi-envelope"></i> ' + escapeHtml(r.email) + '</a>' : '') + '</td>' +
        '<td data-label="Donor ID">' + escapeHtml(r.donor_id || '') + '</td>' +
        '<td data-label="สถานะ"><span class="booking-status-pill ' + statusClass + '">' + escapeHtml(r.status) + '</span></td>' +
        '<td data-label="จัดการ">' + actions + '</td>' +
        '</tr>';
    }).join("") +
    '</tbody></table>';
}

async function staffSetPlateletBookingStatus(bookingId, status) {
  const isStaff = await ensureStaff(true); if (!isStaff) return;
  const { data, error } = await sb.rpc("staff_set_platelet_booking_status", { p_booking_id:bookingId, p_status:status });
  if (error || !data || data.ok !== true) {
    showModal({ title:"บันทึกไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
    return;
  }
  await loadStaffBookings();
  await loadPlateletMonthAdmin();
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

function roomCalendarCellHtml(day, iso, range, event, clickable, publicMode) {
  const meta = event ? roomEventMeta(event.type) : null;
  let className = "room-day-cell";
  let label = "";
  let icon = "";
  let detail = "";

  if (event) {
    className += " " + meta.className;
    label = meta.label;
    icon = '<i class="bi ' + meta.icon + '"></i>';
    detail = event.title || event.location || event.time || "";
  } else {
    className += " event-normal";
    label = "เปิด";
    icon = '<i class="bi bi-check-circle"></i>';
    detail = publicMode ? "เปิดตามปกติ" : "ปกติ";
  }

  const inner = '<div class="room-day-number">' + day + '</div><div class="room-day-state">' + icon + '<b>' + escapeHtml(label) + '</b></div>' + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '');
  if (clickable) return '<button type="button" class="' + className + '" onclick="selectRoomAdminDate(\'' + iso + '\')">' + inner + '</button>';
  return '<div class="' + className + '">' + inner + '</div>';
}

function renderRoomCalendar(container, month, events, clickable, publicMode) {
  const range = monthRange(month);
  if (!container || !range) return;
  const eventMap = {};
  (events || []).forEach(e => eventMap[e.date] = e);
  const headers = ["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."];
  let html = '<div class="room-calendar-head">' + headers.map(h => '<div>' + h + '</div>').join('') + '</div><div class="room-calendar-days">';
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
  if (status) status.innerHTML = '<div class="published-banner"><i class="bi bi-check2-circle"></i><span><b>' + escapeHtml(thaiMonthLabel(month)) + '</b> · ตารางที่เผยแพร่แล้ว</span></div>';
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
  else setStaffResult(box, "เตรียมปฏิทิน " + thaiMonthLabel(month) + " แล้ว\nทุกวันตั้งต้นเป็นเปิด ให้เพิ่มเฉพาะวันที่ปิด รับจำกัด ออกหน่วย หรือมีกิจกรรมพิเศษ", true);
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
  lines.push("");
  lines.push("วันที่ไม่มีประกาศพิเศษ: เปิดทำการตามปกติ");
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
  if ($("roomAdminMonthStatus")) {
    $("roomAdminMonthStatus").innerText = data.published ? "เผยแพร่แล้ว" : "ฉบับร่าง · ผู้บริจาคยังไม่เห็น";
    $("roomAdminMonthStatus").className = data.published ? "published" : "draft";
  }
  if ($("roomAdminMonthHint")) $("roomAdminMonthHint").innerText = data.published ? "หน้า Public ใช้ข้อมูลชุดนี้อยู่" : "ตรวจวันปิด/ออกหน่วยให้ครบก่อนเผยแพร่";

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
  if (error || !data || data.ok !== true) showModal({ title:"บันทึกไม่สำเร็จ", message:error?.message || data?.message || "กรุณาลองใหม่", iconText:"!" });
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

function openNotificationTarget(type, sourceId) {
  if (type === "platelet") {
    if ($("bookingListDate")) $("bookingListDate").value = todayISO();
    showStaffTab("bookings");
  } else if (type === "group") showStaffTab("groups");
  else if (type === "mobile") showStaffTab("mobileUnits");
  else if (type === "calendar") showStaffTab("roomCalendar");
}

async function markStaffNotificationRead(id, openType, sourceId) {
  const ok = await ensureStaff(false); if (!ok) return;
  await sb.rpc("mark_staff_notification_read", { p_notification_id:id });
  await refreshStaffNotificationBadge();
  if (openType) openNotificationTarget(openType, sourceId || "");
  else loadStaffNotifications();
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
      '<div class="notification-item-actions">' + (!r.is_read ? '<button type="button" class="btn btn-soft btn-sm" onclick=\'markStaffNotificationRead(' + idArg + ')\'>อ่านแล้ว</button>' : '') + '<button type="button" class="btn btn-search btn-sm" onclick=\'markStaffNotificationRead(' + idArg + ',' + typeArg + ',' + sourceArg + ')\'>เปิดรายการ</button></div>' +
    '</article>';
  }).join('');
  await refreshStaffNotificationBadge();
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
    bookingDate.max = getNextMonthEndISO();
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
    publicRoomMonth.max = nextMonthValue();
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
    roomAdminMonth.max = nextMonthValue();
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
      navigator.serviceWorker.register("service-worker.js?v=15.2").catch(function(err) {
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
  await handleHashRoute();
});

window.addEventListener("hashchange", function() { handleHashRoute(); });
window.addEventListener("popstate", function() { handleHashRoute(); });
