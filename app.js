/* CNMI Blood Donation Supabase Frontend */

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

sb.auth.onAuthStateChange(async function(event, session) {
  if (event === "PASSWORD_RECOVERY") {
    pendingPasswordRecovery = true;
    if ($("pagePasswordReset")) showPage("passwordReset");
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

function showPage(page) {
  const pages = {
    home:"pageHome", check:"pageCheck", screening:"pageScreening", booking:"pageBooking",
    manage:"pageManage", info:"pageInfo", staffLogin:"pageStaffLogin", passwordReset:"pagePasswordReset", staff:"pageStaff"
  };
  Object.keys(pages).forEach(function(key){ const el = $(pages[key]); if (el) el.classList.remove("active"); });
  const target = $(pages[page] || "pageHome");
  if (target) target.classList.add("active");
  window.scrollTo(0,0);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, function(ch) {
    return ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[ch];
  });
}

function onlyDigits(value) { return String(value || "").replace(/[^0-9]/g, ""); }
function cleanLookupText(value) { return String(value || "").replace(/[^A-Za-z0-9ก-๙]/g, "").toUpperCase(); }
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() { return new Date().toISOString().split("T")[0]; }

function normalizePublicDobInput(value) {
  let text = String(value || "").trim();
  if (!text) return "";

  // ถ้าเป็น input date เดิมหรือ browser คืนค่า yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  text = text.replace(/[.\-]/g, "/").replace(/\s+/g, "");
  const parts = text.split("/");
  if (parts.length !== 3) return "";

  let d = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  let yRaw = String(parts[2] || "").trim();
  let y = parseInt(yRaw, 10);

  if (!d || !m || Number.isNaN(y)) return "";

  // รองรับ พ.ศ.
  if (y > 2400) y = y - 543;

  // รองรับปี ค.ศ. 2 หลัก เช่น 35 = 2535/1992? สำหรับวันเกิดให้เดาเป็น 1900/2000 ตามปีปัจจุบัน
  if (/^\d{1,2}$/.test(yRaw)) {
    const currentYY = Number(new Date().getFullYear().toString().slice(-2));
    y = y <= currentYY ? 2000 + y : 1900 + y;
  }

  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > new Date().getFullYear()) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function formatDobInputOnBlur(input) {
  if (!input) return;
  const iso = normalizePublicDobInput(input.value);
  if (!iso) return;
  input.value = isoToDDMMYYYY(iso);
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

function normalizeStaffEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isAllowedStaffEmail(email) {
  const domain = String(CONFIG.STAFF_EMAIL_DOMAIN || "mahidol.ac.th").toLowerCase();
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

  if (!donorId || !dob || phoneLast4.length !== 4) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอก Donor ID วันเกิดเป็น วัน/เดือน/ปี และเบอร์โทรศัพท์หรือ 4 ตัวท้ายให้ครบครับ", iconText:"!" });
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

  $("checkResult").style.display = "block";
}

async function runForgotSearch() {
  const idDoc = cleanLookupText($("idDocForgot").value);
  const dobRaw = $("donorDobForgot").value;
  const dob = normalizePublicDobInput(dobRaw);
  const phoneLast4 = last4FromInput($("phoneLast4Forgot").value);
  const btn = $("btnForgotSearch");

  if (!idDoc || !dob || phoneLast4.length !== 4) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกเลขเอกสาร วันเกิดเป็น วัน/เดือน/ปี และเบอร์โทรศัพท์หรือ 4 ตัวท้ายให้ครบครับ", iconText:"!" });
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

function startScreening() { showPage("screening"); resetScreening(); }
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
    message:"สามารถดำเนินการจองคิวได้ครับ",
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
    grid.innerHTML = '<div class="text-muted small" style="grid-column:1/-1;">กรุณาเลือกวันที่ก่อน ระบบจะแสดงช่วงเวลาที่ว่าง</div>';
    return;
  }

  grid.innerHTML = '<div class="text-muted small" style="grid-column:1/-1;">กำลังโหลดช่วงเวลาที่ว่าง...</div>';
  const { data, error } = await sb.rpc("get_booking_slots", { p_booking_date: bookingDate });
  if (error || !data || !data.ok) {
    grid.innerHTML = '<div class="text-danger small" style="grid-column:1/-1;">' + escapeHtml(error?.message || data?.message || "ไม่สามารถโหลดช่วงเวลาได้") + '</div>';
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
    const isFull = remaining <= 0 || slot.status === "ปิด";
    const cls = isFull ? "slot-btn full" : "slot-btn";
    const text = isFull ? "เต็มแล้ว" : "ว่าง " + remaining;
    return '<button type="button" class="' + cls + '" onclick="selectSlot(this, \'' + escapeHtml(slot.time) + '\')">' + escapeHtml(slot.time) + '<br><span style="font-size:.78rem;">👥 ' + text + '</span></button>';
  }).join("");
}

async function submitBooking() {
  const name = $("bookingName").value.trim();
  const donorId = $("bookingDonorId").value.trim();
  const phone = onlyDigits($("bookingPhone").value);
  const bookingDate = $("bookingDate").value;
  const btn = $("btnConfirmBooking");

  if (!name || phone.length < 9 || !bookingDate || !selectedSlot) {
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอกชื่อ เบอร์โทร วันที่ และเลือกช่วงเวลาให้ครบครับ", iconText:"!" });
    return;
  }

  showBusy(btn, true, "ยืนยันการจอง", "กำลังบันทึกการจอง...");
  const { data, error } = await sb.rpc("create_booking", {
    p_name: name,
    p_donor_id: donorId,
    p_phone: phone,
    p_booking_date: bookingDate,
    p_time_slot: selectedSlot,
    p_donation_type: "Whole Blood"
  });
  showBusy(btn, false, "ยืนยันการจอง", "กำลังบันทึกการจอง...");

  if (error || !data || !data.ok) {
    showModal({ title:"ไม่สามารถจองคิวได้", message:error?.message || data?.message || "กรุณาลองใหม่ครับ", iconText:"!" });
    loadBookingSlots();
    return;
  }

  showModal({
    title:"จองคิวสำเร็จครับ",
    message:"เลขที่จอง: " + data.bookingId + "\nวันที่: " + isoToThaiDate(data.bookingDate, true) + "\nเวลา: " + data.timeSlot + "\n\nกรุณาบันทึกเลขที่จองไว้สำหรับตรวจสอบหรือยกเลิกนัดหมาย",
    iconText:"✓",
    type:"success"
  });
  $("bookingName").value = "";
  $("bookingDonorId").value = "";
  $("bookingPhone").value = "";
  loadBookingSlots();
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
    showModal({ title:"กรอกข้อมูลไม่ครบ", message:"กรุณากรอก Booking ID และเบอร์โทรศัพท์ 4 ตัวท้ายให้ครบครับ", iconText:"!" });
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

  currentManageBooking = { bookingId, phoneLast4, status:data.status || "" };
  $("manageDisplayBookingId").innerText = data.bookingId || "-";
  $("manageDisplayName").innerText = data.name || "-";
  $("manageDisplayDateTime").innerText = isoToThaiDate(data.bookingDate, true) + " เวลา " + (data.timeSlot || "-");
  $("manageDisplayStatus").innerText = data.status || "-";
  $("btnCancelBooking").style.display = (data.status || "") === "ยกเลิก" ? "none" : "block";
  $("manageResult").style.display = "block";
}

function confirmCancelBooking() {
  if (!currentManageBooking) {
    showModal({ title:"ไม่พบรายการจอง", message:"กรุณาตรวจสอบนัดหมายก่อนยกเลิกครับ", iconText:"!" });
    return;
  }
  showModal({
    title:"ยืนยันการยกเลิกนัดหมาย",
    message:"ต้องการยกเลิกนัดหมายเลขที่จอง " + currentManageBooking.bookingId + " ใช่หรือไม่",
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
    message:"ระบบได้ยกเลิกนัดหมายเลขที่จอง " + currentManageBooking.bookingId + " แล้ว",
    iconText:"✓",
    type:"success",
    onPrimary:function(){ findBookingUI(); loadBookingSlots(); }
  });
}

async function showStaffGate() {
  const ok = await ensureStaff(false);
  if (ok) showPage("staff");
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
  if (ok) showPage("staff");
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

function applyStaffProfileUI() {
  const profile = currentStaffProfile || {};
  const isAdmin = profile.role === "admin";
  const bar = $("staffProfileBar");
  if (bar) {
    bar.style.display = "block";
    bar.innerText = "เข้าสู่ระบบ: " + (profile.display_name || profile.email || "เจ้าหน้าที่") + " | สิทธิ์: " + (profile.role || "staff");
  }
  const adminBtn = $("staffTabBtn_admin");
  if (adminBtn) adminBtn.style.display = isAdmin ? "block" : "none";
}

async function requireAdmin() {
  const ok = await ensureStaff(true);
  if (!ok) return false;
  if (!currentStaffProfile || currentStaffProfile.role !== "admin") {
    showModal({ title:"ไม่มีสิทธิ์ Admin", message:"เมนูนี้ใช้ได้เฉพาะผู้ดูแลระบบ", iconText:"!" });
    return false;
  }
  return true;
}

async function staffLogout() {
  await sb.auth.signOut();
  currentStaffProfile = null;
  showPage("home");
}

function showStaffTab(tab) {
  if (tab === "admin" && (!currentStaffProfile || currentStaffProfile.role !== "admin")) {
    showModal({ title:"ไม่มีสิทธิ์ Admin", message:"เมนูนี้ใช้ได้เฉพาะผู้ดูแลระบบ", iconText:"!" });
    return;
  }
  document.querySelectorAll(".staff-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.staffTab === tab));
  document.querySelectorAll(".staff-tab-page").forEach(page => page.classList.remove("active"));
  const target = $("staffTab_" + tab);
  if (target) target.classList.add("active");
  if (tab === "admin") adminLoadStaffAccessList();
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

async function importDonorFile() {
  const file = $("donorImportFile").files[0];
  const btn = $("btnImportDonor");
  const box = $("donorImportResult");
  if (!file) { setStaffResult(box, "กรุณาเลือกไฟล์ Excel ก่อน", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  showBusy(btn, true, "นำเข้า Supabase", "กำลังอ่านไฟล์...");
  try {
    const workbook = await readWorkbookFromFile(file);
    const parsed = parseDonorWorkbook(workbook);
    const records = parsed.records;
    if (records.length === 0) {
      setStaffResult(box, "ไม่พบข้อมูลที่นำเข้าได้\nข้ามข้อมูลสำคัญไม่ครบ: " + parsed.skippedMissing, false);
      return;
    }

    let inserted = 0;
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const { error } = await sb.from("donor_donations").upsert(chunk, {
        onConflict: "donor_id,donation_date,donation_type",
        ignoreDuplicates: true
      });
      if (error) throw error;
      inserted += chunk.length;
    }

    await sb.from("import_logs").insert({
      import_type: "donor_import",
      imported_count: records.length,
      skipped_count: (parsed.skippedNoUnit || 0) + (parsed.skippedCannotDonate || 0) + (parsed.skippedMissing || 0),
      message: `mode=${parsed.mode}, file=${file.name}`
    });

    setStaffResult(box,
      "นำเข้าข้อมูลผู้บริจาคเสร็จแล้ว\n\n" +
      "โหมดไฟล์: " + parsed.mode + "\n" +
      "ส่งเข้า Supabase: " + inserted + " รายการ\n" +
      "ข้าม เพราะไม่มี Unit No: " + (parsed.skippedNoUnit || 0) + " รายการ\n" +
      "ข้าม เพราะบริจาคไม่ได้: " + (parsed.skippedCannotDonate || 0) + " รายการ\n" +
      "ข้าม เพราะข้อมูลสำคัญไม่ครบ: " + (parsed.skippedMissing || 0) + " รายการ\n\n" +
      "หมายเหตุ: ข้อมูลซ้ำจะไม่เพิ่มซ้ำจาก key Donor ID + วันที่บริจาค + ชนิดบริจาค",
      true
    );
  } catch (err) {
    setStaffResult(box, "นำเข้าไม่สำเร็จ\n" + (err.message || err), false);
  } finally {
    showBusy(btn, false, "นำเข้า Supabase", "กำลังอ่านไฟล์...");
  }
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

async function saveBookingSlot() {
  const box = $("slotResult");
  const btn = $("btnSaveSlot");
  const bookingDate = $("slotDate").value;
  const timeSlot = $("slotTime").value;
  const maxQueue = Number($("slotMax").value || 0);
  const status = $("slotStatus").value;
  if (!bookingDate || !timeSlot) { setStaffResult(box, "กรุณาเลือกวันที่และเวลา", false); return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  showBusy(btn, true, "บันทึกรอบจอง", "กำลังบันทึก...");
  const { error } = await sb.from("booking_slots").upsert({
    booking_date: bookingDate,
    time_slot: timeSlot,
    max_queue: maxQueue,
    status: status
  }, { onConflict:"booking_date,time_slot" });
  showBusy(btn, false, "บันทึกรอบจอง", "กำลังบันทึก...");

  if (error) setStaffResult(box, "บันทึกไม่สำเร็จ\n" + error.message, false);
  else setStaffResult(box, "บันทึกรอบจองสำเร็จ\nวันที่: " + isoToDDMMYYYY(bookingDate) + "\nเวลา: " + timeSlot + "\nจำนวนรับ: " + maxQueue + "\nสถานะ: " + status, true);
}

async function loadStaffBookings() {
  const date = $("bookingListDate").value;
  const box = $("staffBookingsResult");
  if (!date) { box.innerHTML = '<div class="staff-result fail">กรุณาเลือกวันที่</div>'; return; }
  const isStaff = await ensureStaff(true); if (!isStaff) return;

  box.innerHTML = '<div class="staff-result">กำลังโหลด...</div>';
  const { data, error } = await sb.from("bookings")
    .select("booking_id,full_name,phone,donor_id,booking_date,time_slot,donation_type,status,note")
    .eq("booking_date", date)
    .order("time_slot", { ascending:true });
  if (error) {
    box.innerHTML = '<div class="staff-result fail">โหลดไม่สำเร็จ\n' + escapeHtml(error.message) + '</div>';
    return;
  }
  if (!data || data.length === 0) {
    box.innerHTML = '<div class="staff-result">ไม่พบรายการจองในวันนี้</div>';
    return;
  }
  box.innerHTML = '<table class="table table-sm preview-table"><thead><tr><th>เวลา</th><th>ชื่อ</th><th>โทร</th><th>Donor ID</th><th>Status</th></tr></thead><tbody>' +
    data.map(r => '<tr><td>' + escapeHtml(String(r.time_slot).slice(0,5)) + '</td><td>' + escapeHtml(r.full_name) + '</td><td>' + escapeHtml(r.phone) + '</td><td>' + escapeHtml(r.donor_id || '') + '</td><td>' + escapeHtml(r.status) + '</td></tr>').join("") +
    '</tbody></table>';
}

async function adminSaveStaffAccess() {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return;

  const email = normalizeStaffEmail($("adminStaffEmail").value);
  const displayName = String($("adminStaffDisplayName").value || "").trim();
  const role = $("adminStaffRole").value || "staff";
  const btn = $("btnAdminSaveStaff");
  const box = $("adminStaffResult");

  if (!email || !displayName) { setStaffResult(box, "กรุณากรอก Email และชื่อที่แสดง", false); return; }
  if (!isAllowedStaffEmail(email)) { setStaffResult(box, "กรุณาใช้ email @" + (CONFIG.STAFF_EMAIL_DOMAIN || "mahidol.ac.th"), false); return; }

  showBusy(btn, true, "เพิ่ม/แก้ไขสิทธิ์เจ้าหน้าที่", "กำลังบันทึก...");
  const { data, error } = await sb.rpc("admin_upsert_staff_access", {
    p_email: email,
    p_display_name: displayName,
    p_role: role,
    p_is_active: true
  });
  showBusy(btn, false, "เพิ่ม/แก้ไขสิทธิ์เจ้าหน้าที่", "กำลังบันทึก...");

  if (error || !data || data.ok !== true) {
    setStaffResult(box, "บันทึกไม่สำเร็จ\n" + (error?.message || data?.message || "ไม่สามารถบันทึกได้"), false);
    return;
  }

  setStaffResult(box, "บันทึกสิทธิ์เจ้าหน้าที่สำเร็จ\n\nEmail: " + email + "\nสิทธิ์: " + role + "\n\nถ้าเป็นผู้ใช้ใหม่ ให้น้องกด 'ตั้งรหัสผ่านครั้งแรก' แล้วตั้งรหัสเอง", true);
  adminLoadStaffAccessList();
}

async function adminSendPasswordReset() {
  const isAdmin = await requireAdmin();
  if (!isAdmin) return;

  const email = normalizeStaffEmail($("adminStaffEmail").value);
  const ok = await sendPasswordResetEmail(email, $("adminStaffResult"), $("btnAdminSendReset"), "ส่งอีเมลรีเซตรหัสผ่านให้คนนี้");
  if (ok) adminLoadStaffAccessList();
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
  box.innerHTML = '<table class="table table-sm preview-table"><thead><tr><th>Email</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>สมัครแล้ว</th></tr></thead><tbody>' +
    rows.map(function(r) {
      return '<tr>' +
        '<td>' + escapeHtml(r.email || '') + '</td>' +
        '<td>' + escapeHtml(r.display_name || '') + '</td>' +
        '<td>' + escapeHtml(r.role || '') + '</td>' +
        '<td>' + (r.is_active ? 'เปิดใช้' : 'ปิดใช้') + '</td>' +
        '<td>' + (r.has_auth_user ? 'มีบัญชีแล้ว' : 'ยังไม่สมัคร') + '</td>' +
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
      input.value = String(input.value || "").replace(/[^0-9/.-]/g, "").slice(0, 10);
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
  if (bookingDate) { bookingDate.min = today; bookingDate.addEventListener("change", loadBookingSlots); }
  const slotDate = $("slotDate"); if (slotDate) slotDate.min = today;
  const bookingListDate = $("bookingListDate"); if (bookingListDate) bookingListDate.value = today;
}

document.addEventListener("DOMContentLoaded", async function() {
  initConfigText();
  initInputs();

  const hashText = String(window.location.hash || "") + " " + String(window.location.search || "");
  if (pendingPasswordRecovery || hashText.includes("type=recovery")) {
    showPage("passwordReset");
    return;
  }

  if (location.hash === "#staff") showStaffGate();
});
