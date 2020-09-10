const server = require('http').createServer();

const io = require('socket.io')(server, {
	path: '/ws',
});

// 缓存多个房间
const channels = {};

// 缓存连接数
const sockets = {};

io.sockets.on('connection', (socket) => {
	const socketHostName = socket.handshake.headers.host.split(':')[0];
	socket.channels = {};
	sockets[socket.id] = socket;
	console.log(`[${socket.id}] connection accepted`);
	
	socket.on('disconnect', () => {
		for (const channel in socket.channels) {
			remove(channel);
		}
		console.log(`[${socket.id}] disconnected`);
		delete sockets[socket.id];
	});

	socket.on('join', (config) => {
		const channel = socketHostName + config.channel;
		if (channel in socket.channels) return;

		if (!(channel in channels)) {
			channels[channel] = {};
		}

		for (id in channels[channel]) {
			channels[channel][id].emit('addPeer', {
				peerId: socket.id,
				shouldCreateOffer: false,
			});
			socket.emit('addPeer', { peerId: id, shouldCreateOffer: true });
		}

		channels[channel][socket.id] = socket;
		socket.channels[channel] = channel;
	});

	/**
	 * 移除通道内人员
	 * @param  {[type]} channel [description]
	 * @return {[type]}         [description]
	 */
	const remove = (channel) => {
		// Socket not in channel
		if (!(channel in socket.channels)) return;

		delete socket.channels[channel];
		delete channels[channel][socket.id];

		for (id in channels[channel]) {
			channels[channel][id].emit('removePeer', { peerId: socket.id });
			socket.emit('removePeer', { peerId: id });
		}
	};

	/**
	 * 候选人信息广播
	 * @param  {[type]} config [description]
	 * @return {[type]}        [description]
	 */
	socket.on('relayICECandidate', (config) => {
		let peerId = config.peerId;
		let iceCandidate = config.iceCandidate;
		console.log(`[${socket.id}] relay ICE-candidate to [${peerId}] ${iceCandidate}`);

		if (peerId in sockets) {
			sockets[peerId].emit('iceCandidate', {
				peerId: socket.id,
				iceCandidate: iceCandidate,
			});
		}
	});

	/**
	 * P2P会话信息广播
	 * @param  {[type]} config [description]
	 * @return {[type]}        [description]
	 */
	socket.on('relaySessionDescription', (config) => {
		let peerId = config.peerId;
		let sessionDescription = config.sessionDescription;
		console.log(`[${socket.id}] relay SessionDescription to [${peerId}] ${sessionDescription}`);

		if (peerId in sockets) {
			sockets[peerId].emit('sessionDescription', {
				peerId: socket.id,
				sessionDescription: sessionDescription,
			});
		}
	});
});

server.listen(6100, () => {
	console.info(`🚀 Server is running at: http://0.0.0.0:6100`);
});
