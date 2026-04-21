import * as amqp from 'amqplib';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const rideEventEmitter = new EventEmitter();
rideEventEmitter.setMaxListeners(0);

const rideEventOriginId = randomUUID();
const rideEventExchangeName = String(env.rabbitMqExchangeName ?? '').trim() || 'smartride.ride.events';
const rideEventRoutingPattern = 'ride.#';

let rideEventConnection = null;
let rideEventChannel = null;
let rideEventQueueName = '';
let rideEventSetupPromise = null;

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function cloneRideEventBooking(booking) {
  if (!booking || typeof booking !== 'object') {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(booking));
  } catch {
    return null;
  }
}

function normalizeRideEvent(event = {}) {
  const normalizedType = normalizeText(event.type ?? event.eventType ?? event.routingKey ?? 'ride.event').toLowerCase();
  const normalizedRoutingKey = normalizeText(event.routingKey ?? normalizedType ?? 'ride.event').toLowerCase() || 'ride.event';
  const normalizedBooking = cloneRideEventBooking(event.booking);
  const normalizedPayload = event.payload && typeof event.payload === 'object' ? cloneRideEventBooking(event.payload) : null;

  return {
    id: normalizeText(event.id) || randomUUID(),
    type: normalizedType || 'ride.event',
    routingKey: normalizedRoutingKey,
    bookingCode: normalizeText(event.bookingCode ?? normalizedBooking?.bookingCode),
    customerAccountId: normalizeText(event.customerAccountId ?? normalizedBooking?.customerAccountId),
    driverAccountId: normalizeText(event.driverAccountId ?? normalizedBooking?.driverAccountId),
    tripStatus: normalizeText(event.tripStatus ?? normalizedBooking?.tripStatus),
    tripStatusLabel: normalizeText(event.tripStatusLabel ?? normalizedBooking?.tripStatusLabel),
    tripStatusTone: normalizeText(event.tripStatusTone ?? normalizedBooking?.tripStatusTone),
    audience: Array.isArray(event.audience)
      ? event.audience.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
      : [],
    booking: normalizedBooking,
    payload: normalizedPayload,
    originInstanceId: normalizeText(event.originInstanceId) || rideEventOriginId,
    source: normalizeText(event.source) || 'backend',
    createdAt: normalizeText(event.createdAt) || new Date().toISOString(),
  };
}

function emitRideEvent(event) {
  rideEventEmitter.emit('ride-event', event);
  return event;
}

function clearRideEventBrokerState() {
  rideEventConnection = null;
  rideEventChannel = null;
  rideEventQueueName = '';
}

function handleRideEventBrokerDisconnect(error) {
  if (error) {
    console.warn('[realtime] RabbitMQ ride event broker disconnected:', error.message ?? error);
  }

  clearRideEventBrokerState();
}

async function ensureRideEventBroker() {
  if (!env.rabbitMqUrl) {
    return null;
  }

  if (rideEventChannel) {
    return rideEventChannel;
  }

  if (rideEventSetupPromise) {
    return rideEventSetupPromise;
  }

  rideEventSetupPromise = (async () => {
    try {
      const connection = await amqp.connect(env.rabbitMqUrl);
      rideEventConnection = connection;

      connection.on('close', () => handleRideEventBrokerDisconnect(null));
      connection.on('error', (error) => handleRideEventBrokerDisconnect(error));

      const channel = await connection.createChannel();
      rideEventChannel = channel;

      await channel.assertExchange(rideEventExchangeName, 'topic', {
        durable: true,
      });

      const queueResult = await channel.assertQueue('', {
        exclusive: true,
        autoDelete: true,
      });

      rideEventQueueName = queueResult.queue;
      await channel.bindQueue(rideEventQueueName, rideEventExchangeName, rideEventRoutingPattern);

      await channel.consume(
        rideEventQueueName,
        (message) => {
          if (!message) {
            return;
          }

          try {
            const rawContent = message.content.toString('utf8');
            const parsedContent = rawContent ? JSON.parse(rawContent) : {};
            const normalizedEvent = normalizeRideEvent(parsedContent);

            if (normalizedEvent.originInstanceId !== rideEventOriginId) {
              emitRideEvent(normalizedEvent);
            }
          } catch (error) {
            console.warn('[realtime] Không thể đọc sự kiện RabbitMQ:', error);
          } finally {
            channel.ack(message);
          }
        },
        {
          noAck: false,
        },
      );

      console.log(`[realtime] RabbitMQ ride event broker connected (${rideEventExchangeName}, queue: ${rideEventQueueName}).`);
      return channel;
    } catch (error) {
      console.warn('[realtime] Không thể khởi tạo RabbitMQ ride event broker, sẽ dùng fallback cục bộ.', error);
      clearRideEventBrokerState();
      return null;
    } finally {
      rideEventSetupPromise = null;
    }
  })();

  return rideEventSetupPromise;
}

export async function connectRideEventBroker() {
  return ensureRideEventBroker();
}

export function subscribeRideEvents(listener) {
  rideEventEmitter.on('ride-event', listener);

  return () => {
    rideEventEmitter.off('ride-event', listener);
  };
}

export async function publishRideEvent(event = {}) {
  const normalizedEvent = normalizeRideEvent(event);

  emitRideEvent(normalizedEvent);

  try {
    const channel = await ensureRideEventBroker();

    if (!channel) {
      return normalizedEvent;
    }

    channel.publish(
      rideEventExchangeName,
      normalizedEvent.routingKey || 'ride.event',
      Buffer.from(JSON.stringify(normalizedEvent), 'utf8'),
      {
        contentType: 'application/json',
        deliveryMode: 2,
        messageId: normalizedEvent.id,
        timestamp: Date.now(),
        type: normalizedEvent.type,
        headers: {
          originInstanceId: normalizedEvent.originInstanceId,
        },
      },
    );
  } catch (error) {
    console.warn('[realtime] Không thể publish sự kiện lên RabbitMQ, giữ fallback cục bộ.', error);
  }

  return normalizedEvent;
}