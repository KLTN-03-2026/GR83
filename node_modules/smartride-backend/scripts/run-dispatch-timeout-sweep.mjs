import { runTimedOutDispatchSweep } from '../src/services/ride.service.js';

try {
  const result = await runTimedOutDispatchSweep({ maxRows: 200 });
  console.log(JSON.stringify({ success: true, result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    message: String(error?.message || error),
  }, null, 2));
  process.exit(1);
}
