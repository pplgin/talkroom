const appURL = () => {
	const protocol =
		'http' + (location.hostname == 'localhost' ? '' : 's') + '://';
	return (
		protocol +
		location.hostname +
		(location.hostname == 'localhost' ? ':6100' : '')
	);
};

/**
 * 生成房间编号
 * @return {[type]} [description]
 */
const getRoomName = () => {
	let roomName = location.pathname.split('/talk/');
	if (roomName.length < 2) {
		const randomName = () =>
			Math.random()
				.toString(36)
				.substr(2, 6);
		roomName = randomName();
		const newurl = appURL() + '/talk/' + roomName;
		window.history.pushState(
			{
				url: newurl,
			},
			roomName,
			newurl
		);
	}
	return roomName[1];
};

const SIGNALING_SERVER = appURL();
let USE_AUDIO = true;
let USE_VIDEO = true;
let CAMERA = 'user';
let IS_SCREEN_STREAMING = false;
const ROOM_ID = getRoomName();
let peerConnection = null;

const ICE_SERVERS = [
	{
		urls: 'turn:tools.pplgin.xyz:3478',
		username: 'pplgin',
		credential: 'pplgin0813',
	},
];

// 本地视频流
let localMediaStream = null;

const peers = {};
// 缓存视频节点
const peerMediaElements = {};

/**
 * 视频节点添加视频流
 * @param  {[type]} element [description]
 * @param  {[type]} stream  [description]
 * @return {[type]}         [description]
 */
const attachMediaStream = (element, stream) => {
	element.srcObject = stream;
};

/**
 * 初始化链接
 * @return {[type]} [description]
 */
function init() {
	console.log('Connecting to signaling server');
	const signalingSocket = io(SIGNALING_SERVER, {
		path: '/ws/socket.io',
	});

	signalingSocket.on('connect', () => {
		console.log('Connected to signaling server');
		if (localMediaStream) joinChannel(ROOM_ID, {});
		else
			setupLocalMedia(function() {
				// Join the channel once user gives access to microphone & webcam
				joinChannel(ROOM_ID, {});
			});
	});

	signalingSocket.on('disconnect', () => {
		for (peerId in peerMediaElements) {
			document.body.removeChild(peerMediaElements[peerId].parentNode);
			resizeVideos();
		}
		for (peerId in peers) {
			peers[peerId].close();
		}

		peers = {};
		peerMediaElements = {};
	});

	/**
	 * 加入通道
	 * @param  {[type]} channel  [通道信息]
	 * @param  {[type]} userdata [用户信息]
	 */
	function joinChannel(channel, userdata) {
		signalingSocket.emit('join', {
			channel: channel,
			userdata: userdata,
		});
	}

	/**
	 * 创建peerconnection
	 * @param  {[type]} config) {		var       peerId [description]
	 * @param  {[type]} {      optional:     [{     DtlsSrtpKeyAgreement: true }] } 		);		peers[peerId] [description]
	 * @return {[type]}         [description]
	 */
	signalingSocket.on('addPeer', async (config) => {
		var peerId = config.peerId;
		if (peerId in peers) return;
		peerConnection = new RTCPeerConnection(
			{
				iceServers: ICE_SERVERS,
			},
			{
				optional: [
					{
						DtlsSrtpKeyAgreement: true,
					},
				],
			}
		);
		peers[peerId] = peerConnection;

		/**
		 * 添加远端候选人信息
		 */
		peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				signalingSocket.emit('relayICECandidate', {
					peerId,
					iceCandidate: {
						sdpMLineIndex: event.candidate.sdpMLineIndex,
						candidate: event.candidate.candidate,
					},
				});
			}
		};

		/**
		 * 监听远端视频流
		 */
		peerConnection.onaddstream = (event) => {
			const videoWrap = document.createElement('div');
			videoWrap.className = 'video';
			const remoteMedia = document.createElement('video');
			videoWrap.appendChild(remoteMedia);
			remoteMedia.setAttribute('playsinline', true);
			remoteMedia.mediaGroup = 'remotevideo';
			remoteMedia.autoplay = true;
			remoteMedia.controls = false;
			peerMediaElements[peerId] = remoteMedia;
			document.body.appendChild(videoWrap);
			document.getElementById('message').style.display = 'none';

			attachMediaStream(remoteMedia, event.stream);
			resizeVideos();
		};

		/**
		 * 添加本地视频流
		 */
		peerConnection.addStream(localMediaStream);

		if (config.shouldCreateOffer) {
			const localDescription = await peerConnection.createOffer();
			await peerConnection.setLocalDescription(localDescription);
			signalingSocket.emit('relaySessionDescription', {
				peerId: peerId,
				sessionDescription: localDescription,
			});
		}
	});

	signalingSocket.on('sessionDescription', async (config) => {
		const peerId = config.peerId;
		const peer = peers[peerId];
		const remoteDescription = config.sessionDescription;
		try {
			const desc = new RTCSessionDescription(remoteDescription);
			const stuff = await peer.setRemoteDescription(desc);
			if (remoteDescription.type == 'offer') {
				const localDescription = await peer.createAnswer();
				await peer.setLocalDescription(localDescription);
				signalingSocket.emit('relaySessionDescription', {
					peerId,
					sessionDescription: localDescription,
				});
			}
		} catch (e) {
			console.log('err', e);
		}
	});

	signalingSocket.on('iceCandidate', (config) => {
		var peer = peers[config.peerId];
		var iceCandidate = config.iceCandidate;
		peer.addIceCandidate(new RTCIceCandidate(iceCandidate));
	});

	signalingSocket.on('removePeer', (config) => {
		const peerId = config.peerId;
		if (peerId in peerMediaElements) {
			document.body.removeChild(peerMediaElements[peerId].parentNode);
			resizeVideos();
		}
		if (peerId in peers) {
			peers[peerId].close();
		}

		delete peers[peerId];
		delete peerMediaElements[config.peerId];
	});
}

/**
 * 初始化本地视频流
 * @param  {Function} callback  [description]
 * @param  {[type]}   errorback [description]
 * @return {[type]}             [description]
 */
const setupLocalMedia = async (callback, errorback) => {
	if (localMediaStream != null) {
		if (callback) callback();
		return;
	}
	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: USE_AUDIO,
			video: USE_VIDEO,
		});
		document.getElementById('allowaccess').style.display = 'none';
		localMediaStream = stream;
		const videoWrap = document.createElement('div');
		videoWrap.className = 'video';
		videoWrap.setAttribute('id', 'myVideoWrap');

		document.getElementById('mutebtn').addEventListener('click', (e) => {
			localMediaStream.getAudioTracks()[0].enabled = !localMediaStream.getAudioTracks()[0]
				.enabled;
			e.target.className =
				'fas fa-microphone' +
				(localMediaStream.getAudioTracks()[0].enabled ? '' : '-slash');
		});

		document.getElementById('videomutebtn').addEventListener('click', (e) => {
			localMediaStream.getVideoTracks()[0].enabled = !localMediaStream.getVideoTracks()[0]
				.enabled;
			e.target.className =
				'fas fa-video' +
				(localMediaStream.getVideoTracks()[0].enabled ? '' : '-slash');
		});

		navigator.mediaDevices.enumerateDevices().then((devices) => {
			const videoInput = devices.filter(
				(device) => device.kind === 'videoinput'
			);
			if (videoInput.length > 1) {
				document
					.getElementById('swapcamerabtn')
					.addEventListener('click', (e) => {
						swapCamera();
					});
			} else {
				document.getElementById('swapcamerabtn').style.display = 'none';
			}
		});

		if (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia) {
			document
				.getElementById('screensharebtn')
				.addEventListener('click', (e) => {
					toggleScreenSharing();
				});
		} else {
			document.getElementById('screensharebtn').style.display = 'none';
		}

		document.getElementById('buttons').style.opacity = '1';
		document.getElementById('message').style.opacity = '1';

		const localMedia = document.createElement('video');
		videoWrap.appendChild(localMedia);
		localMedia.setAttribute('id', 'myVideo');
		localMedia.setAttribute('playsinline', true);
		localMedia.className = 'mirror';
		localMedia.autoplay = true;
		localMedia.muted = true;
		localMedia.volume = 0;
		localMedia.controls = false;
		document.body.appendChild(videoWrap);
		attachMediaStream(localMedia, stream);
		resizeVideos();
		if (callback) callback();
	} catch (e) {
		alert('无麦克风/音视频设备权限');
		if (errorback) errorback();
	}
};

/**
 * 调整视频框大小
 * @return {[type]} [description]
 */
const resizeVideos = () => {
	const numToString = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
	const videos = document.querySelectorAll('.video');
	document.querySelectorAll('.video').forEach((v) => {
		v.className = 'video ' + numToString[videos.length];
	});
};

/**
 * 屏幕分享
 * @return {[type]} [description]
 */
function toggleScreenSharing() {
	const screenShareBtn = document.getElementById('screensharebtn');
	const videoMuteBtn = document.getElementById('videomutebtn');
	let screenMediaPromise;
	if (!IS_SCREEN_STREAMING) {
		if (navigator.getDisplayMedia) {
			screenMediaPromise = navigator.getDisplayMedia({
				video: true,
			});
		} else if (navigator.mediaDevices.getDisplayMedia) {
			screenMediaPromise = navigator.mediaDevices.getDisplayMedia({
				video: true,
			});
		} else {
			screenMediaPromise = navigator.mediaDevices.getUserMedia({
				video: {
					mediaSource: 'screen',
				},
			});
		}
	} else {
		screenMediaPromise = navigator.mediaDevices.getUserMedia({
			video: true,
		});
		videoMuteBtn.className = 'fas fa-video'; // make sure to enable video
	}
	screenMediaPromise
		.then((screenStream) => {
			IS_SCREEN_STREAMING = !IS_SCREEN_STREAMING;

			var sender = peerConnection
				.getSenders()
				.find((s) => (s.track ? s.track.kind === 'video' : false));
			sender.replaceTrack(screenStream.getVideoTracks()[0]);
			screenStream.getVideoTracks()[0].enabled = true;

			const newStream = new MediaStream([
				screenStream.getVideoTracks()[0],
				localMediaStream.getAudioTracks()[0],
			]);
			localMediaStream = newStream;
			attachMediaStream(document.getElementById('myVideo'), newStream);

			document.getElementById('myVideo').classList.toggle('mirror');
			screenShareBtn.classList.toggle('active');

			var videoBtnDState = document
				.getElementById('videomutebtn')
				.getAttribute('disabled');
			videoBtnDState = videoBtnDState === null ? false : true;
			document.getElementById('videomutebtn').disabled = !videoBtnDState;
			screenStream.getVideoTracks()[0].onended = function() {
				if (IS_SCREEN_STREAMING) toggleScreenSharing();
			};
		})
		.catch((e) => {
			alert('不支持分享.');
			console.error(e);
		});
}

/**
 * 切换摄像头
 * @return {[type]} [description]
 */
const swapCamera = () => {
	CAMERA = CAMERA == 'user' ? 'environment' : 'user';
	if (CAMERA == 'user') USE_VIDEO = true;
	else
		USE_VIDEO = {
			facingMode: {
				exact: CAMERA,
			},
		};
	navigator.mediaDevices
		.getUserMedia({
			video: USE_VIDEO,
		})
		.then((camStream) => {
			if (peerConnection) {
				var sender = peerConnection
					.getSenders()
					.find((s) => (s.track ? s.track.kind === 'video' : false));
				sender.replaceTrack(camStream.getVideoTracks()[0]);
			}
			camStream.getVideoTracks()[0].enabled = true;

			const newStream = new MediaStream([
				camStream.getVideoTracks()[0],
				localMediaStream.getAudioTracks()[0],
			]);
			localMediaStream = newStream;
			attachMediaStream(document.getElementById('myVideo'), newStream);

			document.getElementById('myVideo').classList.toggle('mirror');
		})
		.catch((err) => {
			console.log(err);
			alert('Error is swaping camera');
		});
};
