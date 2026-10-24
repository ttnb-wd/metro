import net from 'node:net';
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : typeof values[0] === 'number'
    ? { port: values[0], host: typeof values[1] === 'string' ? values[1] : 'localhost' } : { path: values[0] };
  if (options?.path || options?.port && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(options.host ?? options.hostname ?? 'localhost')) return original.apply(this, args);
  throw new Error('Release verification permits only loopback and local IPC; external connections blocked.');
};
