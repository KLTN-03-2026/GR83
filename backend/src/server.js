import 'dotenv/config';
import { app } from './app.js';
import { env } from './config/env.js';
import { startNotificationScheduler } from './services/notification.scheduler.js';

app.listen(env.port, () => {
  startNotificationScheduler();
  console.log(`SmartRide backend listening on http://localhost:${env.port}`);
});
