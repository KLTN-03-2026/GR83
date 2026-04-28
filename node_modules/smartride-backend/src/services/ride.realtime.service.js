import * as amqp from 'amqplib';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const rideEventEmitter = new EventEmitter();
rideEventEmitter.setMaxListeners(0);

const rideEventOriginId = randomUUID();
const rideEventExchangeName = String(env.rabbitMqExchangeName ?? '').trim() || 'smartride.ride.events';
const rideEventRoutingPattern = 'ride.#';
const rideLocationRoomPrefix = 'ride.location';

let rideEventConnection = null;
let rideEventChannel = null;
let rideEventQueueName = '';
let rideEventSetupPromise = null;
let rideSocketServer = null;
const latestRideLocationByBookingCode = new Map();

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

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const lat = Number(position.lat ?? position.latitude);
  const lng = Number(position.lng ?? position.longitude ?? position.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const normalizedPosition = {
    lat,
    lng,
  };

  const accuracy = Number(position.accuracy);
  const heading = Number(position.heading);
  const speed = Number(position.speed);

  if (Number.isFinite(accuracy)) {
    normalizedPosition.accuracy = accuracy;
  }

  if (Number.isFinite(heading)) {
    normalizedPosition.heading = heading;
  }

  if (Number.isFinite(speed)) {
    normalizedPosition.speed = speed;
  }

  return normalizedPosition;
}

function normalizeRideLocationEvent(event = {}, socketContext = {}) {
  const bookingCode = normalizeText(event.bookingCode ?? event.booking?.bookingCode);

  if (!bookingCode) {
    return null;
  }

  const normalizedPosition = normalizePosition(event.position ?? event.driverPosition ?? event.location ?? event.coordinates);

  if (!normalizedPosition) {
    return null;
  }

  const customerAccountId = normalizeText(event.customerAccountId ?? event.booking?.customerAccountId ?? socketContext.customerAccountId);
  const driverAccountId = normalizeText(event.driverAccountId ?? event.booking?.driverAccountId ?? socketContext.accountId);

  return {
    id: normalizeText(event.id) || randomUUID(),
    type: 'ride.location.updated',
    routingKey: 'ride.location.updated',
    bookingCode,
    customerAccountId,
    driverAccountId,
    position: normalizedPosition,
    driverName: normalizeText(event.driverName ?? event.driverDisplayName ?? event.booking?.driverName),
    driverVehicleLabel: normalizeText(event.driverVehicleLabel ?? event.booking?.driverVehicleLabel ?? event.booking?.vehicleLabel),
    driverLicensePlate: normalizeText(event.driverLicensePlate ?? event.booking?.driverLicensePlate ?? event.booking?.driverVehicleLicensePlate),
    tripStatus: normalizeText(event.tripStatus ?? event.booking?.tripStatus),
    audience: ['customer', 'driver'],
    booking: cloneRideEventBooking(event.booking),
    originInstanceId: normalizeText(event.originInstanceId) || rideEventOriginId,
    source: normalizeText(event.source) || 'socket',
    createdAt: normalizeText(event.createdAt) || new Date().toISOString(),
  };
}

function getRideLocationRoomName(bookingCode) {
  return `${rideLocationRoomPrefix}:${normalizeText(bookingCode).toLowerCase()}`;
}

function storeLatestRideLocation(event) {
  const bookingCode = normalizeText(event?.bookingCode);

  if (!bookingCode) {
    return;
  }

  latestRideLocationByBookingCode.set(bookingCode.toLowerCase(), event);
}

function getLatestRideLocation(bookingCode) {
  const normalizedBookingCode = normalizeText(bookingCode).toLowerCase();

  if (!normalizedBookingCode) {
    return null;
  }

  return latestRideLocationByBookingCode.get(normalizedBookingCode) ?? null;
}

function broadcastRideEventToSocketClients(event) {
  if (!rideSocketServer || !event) {
    return;
  }

  rideSocketServer.emit('ride.event', event);

  if (event.type === 'ride.location.updated') {
    storeLatestRideLocation(event);
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
  broadcastRideEventToSocketClients(event);
  return event;
}

export function registerRideSocketServer(io) {
  rideSocketServer = io ?? null;

  if (!rideSocketServer) {
    return null;
  }

  rideSocketServer.on('connection', (socket) => {
    const accountId = normalizeText(socket.handshake?.query?.accountId);
    const roleCode = normalizeText(socket.handshake?.query?.roleCode).toUpperCase();

    socket.data.accountId = accountId;
    socket.data.roleCode = roleCode;

    socket.on('ride.location.subscribe', (payload = {}) => {
      const bookingCode = normalizeText(payload.bookingCode);

      if (!bookingCode) {
        return;
      }

      socket.join(getRideLocationRoomName(bookingCode));

      const latestLocation = getLatestRideLocation(bookingCode);

      if (latestLocation) {
        socket.emit('ride.location.snapshot', latestLocation);
      }
    });

    socket.on('ride.location.unsubscribe', (payload = {}) => {
      const bookingCode = normalizeText(payload.bookingCode);

      if (!bookingCode) {
        return;
      }

      socket.leave(getRideLocationRoomName(bookingCode));
    });

    socket.on('ride.location.update', async (payload = {}) => {
      const normalizedEvent = normalizeRideLocationEvent(payload, {
        accountId,
        roleCode,
        customerAccountId: normalizeText(payload.customerAccountId ?? payload.booking?.customerAccountId),
      });

      if (!normalizedEvent) {
        return;
      }

      try {
        await publishRideEvent(normalizedEvent);
      } catch (error) {
        console.warn('[realtime] Không thể phát hành cập nhật vị trí tài xế:', error);
      }
    });
  });

  return rideSocketServer;
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

export function broadcastAdminEvent(eventType, data = {}) {
  if (!rideSocketServer) {
    return;
  }

  rideSocketServer.emit('admin.event', { type: eventType, ...data, createdAt: new Date().toISOString() });
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

  if (normalizedEvent.type === 'ride.location.updated') {
    storeLatestRideLocation(normalizedEvent);
  }

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