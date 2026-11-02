// Registration page logic, shared by every frontend (served at /static/registration.js).
//
// The form is submitted with fetch() to the frontend's own /api/registrations
// endpoint. Because that call is same-origin, the Dash0 Web SDK adds a
// `traceparent` header automatically, so one click becomes ONE trace:
//
//   browser fetch span  ->  registration-web-<lang>  ->  registration-api-<lang>
//
// This file contains FOUR DELIBERATE BUGS for the workshop. Each is marked
// "WORKSHOP BUG" with the README exercise that finds it. Don't fix them before
// you have found them in a session replay.
(function () {
  "use strict";

  // dash0(...) is the queueing stub defined in index.html; it is safe to call
  // before the SDK script has finished loading.
  var dash0 = window.dash0 || function () {};

  var PROMO_CODES = {
    EARLYBIRD: { discount: 20, label: "Early bird · 20% off" },
    "SPEAKER-PASS": { discount: 100, label: "Speaker pass · free" },
  };

  // WORKSHOP BUG: the promo crash (exercises 3 and 4).
  // Codes are looked up by exact match. Anything that is not an exact,
  // upper-case known code ("earlybird", "EARLYBIRD ", "FREE") returns undefined,
  // and reading .discount from undefined throws a TypeError. The backend never
  // sees a request, so no backend trace or log exists for this failure.
  function lookupPromo(raw) {
    if (!raw) {
      return null;
    }
    var promo = PROMO_CODES[raw];
    return { code: raw, discount: promo.discount, label: promo.label };
  }

  var form = document.getElementById("registration");
  var card = document.getElementById("card");
  var promoInput = document.getElementById("promoCode");
  var promoStatus = document.getElementById("promoStatus");
  var applyButton = document.getElementById("applyPromo");
  if (!form) {
    return;
  }

  applyButton.addEventListener("click", function () {
    var promo = lookupPromo(promoInput.value);
    promoStatus.textContent = promo ? promo.label + " applied" : "";
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    // Throws for an unknown promo code (the promo crash). Nothing on screen changes, so
    // a visitor just clicks Register again… and again.
    var promo = lookupPromo(promoInput.value);

    // WORKSHOP BUG: the double submit (exercise 5).
    // The button is never disabled and nothing shows that a request is in
    // flight. A double click (or an impatient second click while the "database"
    // is slow) creates two registrations.
    submitRegistration({
      name: field("name"),
      email: field("email"),
      company: field("company"),
      ticketType: field("ticketType"),
    }, promo);
  });

  function field(id) {
    return document.getElementById(id).value;
  }

  function submitRegistration(registration, promo) {
    fetch("/api/registrations", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(registration),
    })
      .then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          return { status: resp.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status === 200 && result.data.status === "confirmed") {
          renderSuccess(registration, result.data.registrationId, promo);
          // Lets you find this session in Dash0 by the id shown on screen.
          // Deliberately NOT the email address: that is personal data.
          dash0("identify", result.data.registrationId);
          sendOutcome(registration.ticketType, "confirmed");
        } else {
          renderError(result.data.message || "The registration service returned " + result.status,
            result.data.errorType);
          sendOutcome(registration.ticketType, "failed", result.data.errorType);
        }
      })
      .catch(function (err) {
        renderError("Could not reach the registration service: " + err.message, null);
        sendOutcome(registration.ticketType, "failed", "network_error");
      });
  }

  // A custom web event per outcome, with the same bounded attributes the
  // backend puts on its registration.duration metric.
  function sendOutcome(ticketType, outcome, errorType) {
    var attributes = {
      "com.example.registration.ticket_type": ticketType,
      outcome: outcome,
    };
    if (errorType) {
      attributes["error.type"] = errorType;
    }
    dash0("sendEvent", "registration.completed", {
      title: "Registration " + outcome,
      attributes: attributes,
      severity: outcome === "confirmed" ? "INFO" : "WARN",
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function renderSuccess(registration, registrationId, promo) {
    document.title = "Registered · Example Conf";
    // WORKSHOP BUG: the privacy leak (exercise 7).
    // Input VALUES are masked in the replay, but page TEXT is not. This
    // paragraph prints the visitor's name and email as text, so both end up
    // in the recording in plain sight. Exercise 7 fixes it with dash0-mask.
    card.innerHTML =
      '<div class="head ok"><h1>You\'re registered 🎉</h1><p>Example Conf</p></div>' +
      '<div class="body">' +
      "<p>Thanks, <strong>" + esc(registration.name) + "</strong>! A confirmation is on its way to " +
      "<strong>" + esc(registration.email) + "</strong>.</p>" +
      '<p class="muted">Registration id: <code>' + esc(registrationId) + "</code></p>" +
      (promo ? '<p class="muted">Promo: ' + esc(promo.label) + "</p>" : "") +
      '<button type="button" id="addToCalendar">Add to calendar</button>' +
      '<p><a href="/">← Register someone else</a></p>' +
      "</div>";

    // WORKSHOP BUG: the dead button (exercise 6).
    // A typo in the id ("calender") means the handler is never attached. The
    // `if` swallows the null, so there is no error, no failed request, no log:
    // the button just does nothing. Only the visitor's behaviour shows it.
    var calendarButton = document.getElementById("add-to-calender");
    if (calendarButton) {
      calendarButton.addEventListener("click", downloadCalendarFile);
    }
  }

  function renderError(message, errorType) {
    document.title = "Registration failed · Example Conf";
    card.innerHTML =
      '<div class="head err"><h1>Registration failed</h1><p>Example Conf</p></div>' +
      '<div class="body">' +
      "<p>Something went wrong processing your registration.</p>" +
      '<p class="muted">Error: <code>' + esc(message) + "</code></p>" +
      (errorType ? '<p class="muted">Type: <code>' + esc(errorType) + "</code></p>" : "") +
      "<p>Expected in the workshop: find this moment in the session replay, then jump to its trace.</p>" +
      '<p><a href="/">← Try again</a></p>' +
      "</div>";
  }

  function downloadCalendarFile() {
    var ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example Conf//Registration//EN",
      "BEGIN:VEVENT", "UID:example-conf-registration", "SUMMARY:Example Conf",
      "DTSTART;VALUE=DATE:20270101", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    link.download = "example-conf.ics";
    link.click();
  }
})();
