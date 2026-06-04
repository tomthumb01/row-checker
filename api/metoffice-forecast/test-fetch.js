const scraper = require('./index');

async function run() {
  const context = {
    log: console,
    res: null
n  };

  // Simple GET request shape expected by the function
  const req = { method: 'GET' };

  try {
    await scraper(context, req);
    console.log('--- Scraper response body ---');
    console.log(JSON.stringify(context.res && context.res.body, null, 2));
  } catch (err) {
    console.error('Scraper failed:', err);
  }
}

run();
