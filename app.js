const $ = (selector) => document.querySelector(selector);
const form = $("#bookingForm");
const alertBox = $("#formAlert");
const submitButton = $("#submitButton");
const startDate = $("#startDate");
const endDate = $("#endDate");
$("#year").textContent = new Date().getFullYear();

const menuToggle = $("#menuToggle");
const mainNav = $("#mainNav");
menuToggle?.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
});
mainNav?.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
  mainNav.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
}));

const today = new Date();
const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
startDate.min = localToday;
endDate.min = localToday;
startDate.addEventListener("change", () => {
  endDate.min = startDate.value || localToday;
  if (endDate.value && startDate.value && endDate.value < startDate.value) endDate.value = startDate.value;
});
function showAlert(message, type = "error") {
  alertBox.textContent = message;
  alertBox.className = `form-alert ${type}`;
  alertBox.hidden = false;
  alertBox.scrollIntoView({ behavior: "smooth", block: "center" });
}
function hideAlert() { alertBox.hidden = true; alertBox.textContent = ""; }

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert();
  if (!form.reportValidity()) return;
  const selectedItems = [...form.querySelectorAll('input[name="items"]:checked')].map(input => input.value);
  if (!selectedItems.length) {
    showAlert("Please select at least one type of item you want to store.");
    form.querySelector(".item-field").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (endDate.value < startDate.value) {
    showAlert("Your end date must be on or after your start date.");
    endDate.focus();
    return;
  }
  const data = Object.fromEntries(new FormData(form).entries());
  data.items = selectedItems;
  data.fridgeNeeded = selectedItems.includes("Fridge storage");
  data.consent = form.elements.consent.checked;
  submitButton.disabled = true;
  submitButton.textContent = "Sending request…";
  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We couldn't submit your request. Please try again.");
    form.hidden = true;
    $("#successMessage").textContent = `${result.message} Reference: ${result.id}.`;
    $("#successPanel").hidden = false;
    $("#successPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showAlert(error.message || "A connection problem occurred. Please try again or contact B&N Storage on WhatsApp.");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Send storage request <span>↗</span>';
  }
});
$("#newRequest").addEventListener("click", () => {
  form.reset();
  form.hidden = false;
  $("#successPanel").hidden = true;
  hideAlert();
  startDate.min = localToday;
  endDate.min = localToday;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});
