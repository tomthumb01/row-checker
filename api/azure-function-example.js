// Azure Function / Node backend example
// Purpose: fetch the Met Office Lyme Regis page server-side, parse the needed values,
// and return JSON to the web front-end.
//
// Why this exists:
// Browsers often block direct cross-origin scraping of third-party pages.
// A small backend makes the app easy for end-users: they only visit a URL.
//
// Expected front-end path: /api/metoffice-forecast.json or equivalent route.

module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      source: 'Your live Met Office backend goes here',
      updated_text: 'Replace with parsed update timestamp',
      days: []
    }
  };
};