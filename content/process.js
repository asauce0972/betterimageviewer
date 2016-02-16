/* globals Components, Services, addMessageListener, removeMessageListener */
Components.utils.import('resource://gre/modules/Services.jsm');

let viewers = new Set();

let listener = {
	_messages: [
		'BetterImageViewer:disable'
	],
	_notifications: [
		'content-document-global-created'
	],
	init: function() {
		for (let m of this._messages) {
			addMessageListener(m, this);
		}
		for (let n of this._notifications) {
			Services.obs.addObserver(this, n, false);
		}
	},
	destroy: function() {
		for (let m of this._messages) {
			removeMessageListener(m, this);
		}
		for (let n of this._notifications) {
			Services.obs.removeObserver(this, n, false);
		}
		for (let v of viewers) {
			v.destroy();
		}
	},
	receiveMessage: function(message) {
		switch (message.name) {
		case 'BetterImageViewer:disable':
			this.destroy();
			break;
		}
	},
	observe: function(subject) {
		let doc = subject.document;
		if (doc.toString() != '[object ImageDocument]') {
			return;
		}

		viewers.add(new BetterImageViewer(doc));
	}
};
listener.init();

function BetterImageViewer(doc) {
	this._doc = doc;
	this._win = doc.defaultView;
	this._body = doc.body;

	this.init();
}
BetterImageViewer.prototype = {
	_doc: null,
	_win: null,
	_body: null,
	_currentZoom: 0,
	_zoomedToFit: false,
	_lastMousePosition: null,
	_justScrolled: false,
	init: function() {
		this._win.addEventListener('unload', this);
		this._doc.addEventListener('error', this);

		this._link = this._doc.createElement('link');
		this._link.setAttribute('rel', 'stylesheet');
		this._link.setAttribute('href', 'chrome://betterimageviewer/content/betterimageviewer.css');
		this._doc.head.appendChild(this._link);

		this.image = this._body.firstElementChild;

		if (this.image.complete) {
			this.zoomToFit();
		}
		this.image.addEventListener('load', this);
		this.image.addEventListener('click', this);
		this._body.addEventListener('mousedown', this);
		this._win.addEventListener('wheel', this);
		this._win.addEventListener('keypress', this);
		this._win.addEventListener('resize', this);

		let toolbar = this._doc.createElement('div');
		toolbar.id = 'toolbar';
		for (let tool of ['zoomIn', 'zoomOut', 'zoom1', 'zoomFit']) {
			let button = this._doc.createElement('button');
			button.id = tool;
			toolbar.appendChild(button);
		}
		this._body.appendChild(toolbar);
		toolbar.addEventListener('click', this);
	},
	destroy: function() {
		this._win.location.reload();
	},
	get zoom() {
		return this._currentZoom;
	},
	set zoom(z) {
		this._currentZoom = z;
		this._zoomedToFit = false;
		this.image.width = Math.pow(2, z / 4) * this.image.naturalWidth;
		this.image.height = Math.pow(2, z / 4) * this.image.naturalHeight;

		this.image.classList.remove('shrinkToFit');
		this.image.classList.remove('overflowing');
		if (z > 0 || z === 0 && (this.image.naturalWidth > this._body.clientWidth || this.image.naturalHeight > this._body.clientHeight)) {
			this.image.classList.add('overflowing');
		} else if (z < 0) {
			this.image.classList.add('shrinkToFit');
		}
		if (this.image.height > this._body.clientHeight) {
			this.image.classList.add('overflowingVertical');
		} else {
			this.image.classList.remove('overflowingVertical');
		}
	},
	zoomToFit: function() {
		let minZoomX = Math.floor((Math.log2(this._win.innerWidth) - Math.log2(this.image.naturalWidth)) * 4);
		let minZoomY = Math.floor((Math.log2(this._win.innerHeight) - Math.log2(this.image.naturalHeight)) * 4);
		this.zoom = Math.min(minZoomX, minZoomY, 0);
		this._zoomedToFit = true;
	},
	toggleBackground: function() {
		if (!this._body.style.backgroundImage) {
			this._body.style.backgroundColor = '#e5e5e5';
			this._body.style.backgroundImage = 'url("chrome://global/skin/media/imagedoc-lightnoise.png")';
		} else {
			this._body.style.backgroundColor = null;
			this._body.style.backgroundImage = null;
		}
	},
	handleEvent: function(event) {
		switch (event.type) {
		case 'unload':
			viewers.delete(this);
			break;
		case 'error':
			Components.utils.reportError(event);
			break;
		case 'load':
			this.zoomToFit();
			break;
		case 'click':
			if (!!this._justScrolled) {
				this._justScrolled = false;
				return;
			}
			if (event.target.localName == 'button') {
				switch (event.target.id) {
				case 'zoomIn':
					this.zoom++;
					return;
				case 'zoomOut':
					this.zoom--;
					return;
				case 'zoom1':
					this.zoom = 0;
					return;
				case 'zoomFit':
					this.zoomToFit();
					return;
				}
			}
			if (this.zoom === 0) {
				this.zoomToFit();
				return;
			}
			/* falls through */
		case 'wheel':
			let bcr = this.image.getBoundingClientRect();
			let x = (event.clientX - bcr.left) / bcr.width;
			let y = (event.clientY - bcr.top) / bcr.height;

			if (event.type == 'click') {
				this.zoom = 0;
			} else if (event.deltaY < 0) {
				this.zoom++;
			} else {
				this.zoom--;
			}

			bcr = this.image.getBoundingClientRect();
			this._body.scrollTo(bcr.width * x - event.clientX, bcr.height * y - event.clientY);

			event.preventDefault();
			break;
		case 'mousedown':
			if (!event.shiftKey) {
				this._lastMousePosition = { x: event.clientX, y: event.clientY };
				this._win.addEventListener('mousemove', this);
				this._win.addEventListener('mouseup', this);
				event.preventDefault();
			}
			break;
		case 'mousemove':
			let dX = this._lastMousePosition.x - event.clientX;
			let dY = this._lastMousePosition.y - event.clientY;
			if ((dX * dX + dY * dY) < 25) {
				return;
			}
			this._body.scrollBy(dX, dY);
			this._lastMousePosition = { x: event.clientX, y: event.clientY };
			this._justScrolled = true;
			event.preventDefault();
			break;
		case 'mouseup':
			this._lastMousePosition = null;
			this._win.removeEventListener('mousemove', this);
			this._win.removeEventListener('mouseup', this);
			break;
		case 'keypress':
			switch (event.code) {
			case 'Minus':
			case 'NumpadSubtract':
				this.zoom--;
				event.preventDefault();
				break;
			case 'Equal':
			case 'NumpadAdd':
				this.zoom++;
				event.preventDefault();
				break;
			case 'Digit0':
				this.zoomToFit();
				event.preventDefault();
				break;
			}
			break;
		case 'resize':
			if (this._zoomedToFit) {
				this.zoomToFit();
			}
			break;
		}
	}
};
