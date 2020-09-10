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

	// 用户掉线
	socket.on('disconnect', () => {
		for (const channel in socket.channels) {
			remove(channel);
		}
		delete sockets[socket.id];
	});

	// 加入房间
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
	socket.on('relayICECandidate', ({ peerId, iceCandidate}) => {
		console.log(
			`[${socket.id}] relay ICE-candidate to [${peerId}] ${iceCandidate}`
		);
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
	socket.on('relaySessionDescription', ({ peerId, sessionDescription }) => {
		console.log(`[${socket.id}] relay SessionDescription to [${peerId}] ${sessionDescription}`);

		if (peerId in sockets) {
			sockets[peerId].emit('sessionDescription', {
				peerId: socket.id,
				sessionDescription,
			});
		}
	});
});

server.listen(6100, () => {
	console.info(`🚀 Server is running at: http://0.0.0.0:6100`);
});
