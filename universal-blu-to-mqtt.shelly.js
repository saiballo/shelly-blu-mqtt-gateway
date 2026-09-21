/**
* @preserve
* Filename: universal-blu-to-mqtt.shelly.js
*
* Adapted: 20/09/2026 (17:48:41)
* Adapted by: Lorenzo Saibal Forti <lorenzo.forti@gmail.com>
*
* Last update: 20/09/2026 (20:00:03)
* Updated by: Lorenzo Saibal Forti <lorenzo.forti@gmail.com>
*
* SPDX-License-Identifier: Apache-2.0
*
* Based on the Shelly/ALLTERCO "Universal BLU to MQTT Script":
* https://github.com/ALLTERCO/shelly-script-examples/blob/main/ble/universal-blu-to-mqtt.shelly.js
*
* Licensed under the Apache License, Version 2.0.
*/

/* global BLE, MQTT, Shelly */

/**
 * add the MAC addresses managed exclusively by this gateway. change only this list when installing the script on another gateway
 *
 * aggiungere gli indirizzi MAC gestiti esclusivamente da questo gateway. modificare solo questa lista quando si usa lo script su altro gateway
 */
const allowedDeviceList = {
	// door
	"aa:bb:cc:dd:ee:11": true,
	// window
	"aa:bb:cc:dd:ee:22": true
};

// decoding method
// metodo di decodifica
const uint8 = 0;
const int8 = 1;
const uint16 = 2;
const int16 = 3;
const uint24 = 4;
const int24 = 5;

/**
 * the object defines the structure of the BTHome data
 *
 * l'oggetto definisce la struttura dei dati BTHome
 */
/* eslint-disable */
const btHomeData = {
	0x00: {"n": "pid", t: uint8},
	0x01: {"n": "battery", t: uint8, u: "%"},
	0x02: {"n": "temperature", t: int16, f: 0.01, u: "tC"},
	0x03: {"n": "humidity", t: uint16, f: 0.01, u: "%"},
	0x05: {"n": "illuminance", t: uint24, f: 0.01},
	0x21: {"n": "motion", t: uint8},
	0x2c: {"n": "vibration", t: uint8},
	0x2d: {"n": "window", t: uint8},
	0x2e: {"n": "humidity", t: uint8, u: "%"},
	0x3a: {"n": "button", t: uint16},
	0x3f: {"n": "rotation", t: int16, f: 0.1},
	0x40: {"n": "distance_mm", t: uint16},
	0x45: {"n": "temperature", t: int16, f: 0.1, u: "tC"},
};
/* eslint-enable */

const getByteSize = function(type) {

	if (type === uint8 || type === int8) return 1;
	if (type === uint16 || type === int16) return 2;
	if (type === uint24 || type === int24) return 3;

	// impossible as advertisements are much smaller.
	// impossibile perchè le pubblicita Bluetooth sono molto piu' piccole
	return 255;
};

/**
 * functions for decoding and unpacking the service data from Shelly BLU devices
 *
 * funzioni per decodificare e separare i dati di servizio dei dispositivi Shelly BLU
 */
/* eslint-disable */
const btHomeDecoder = {

	"utoi": function(num, bitsz) {

		const mask = 1 << bitsz - 1;
		return num & mask ? num - (1 << bitsz) : num;
	},
	"getUInt8": function(buffer) {

		return buffer.at(0);
	},
	"getInt8": function(buffer) {

		return this.utoi(this.getUInt8(buffer), 8);
	},
	"getUInt16LE": function(buffer) {

		return 0xffff & ((buffer.at(1) << 8) | buffer.at(0));
	},
	"getInt16LE": function(buffer) {

		return this.utoi(this.getUInt16LE(buffer), 16);
	},
	"getUInt24LE": function(buffer) {

		return 0x00ffffff & ((buffer.at(2) << 16) | (buffer.at(1) << 8) | buffer.at(0));
	},
	"getInt24LE": function(buffer) {

		return this.utoi(this.getUInt24LE(buffer), 24);
	},
	"getBufValue": function(type, buffer) {

		if (buffer.length < getByteSize(type)) return null;

		let res = null;

		if (type === uint8) res = this.getUInt8(buffer);
		if (type === int8) res = this.getInt8(buffer);
		if (type === uint16) res = this.getUInt16LE(buffer);
		if (type === int16) res = this.getInt16LE(buffer);
		if (type === uint24) res = this.getUInt24LE(buffer);
		if (type === int24) res = this.getInt24LE(buffer);

		return res;
	},
	/* eslint-enable */

	// unpacks the service data buffer from a Shelly BLU device
	// separa il buffer dei dati di servizio di un dispositivo Shelly BLU
	"unpack": function(buffer) {

		// beacons might not provide BTHome service data
		// i beacon potrebbero non fornire dati di servizio BTHome
		if (typeof buffer !== "string" || buffer.length === 0) return null;

		const result = {};
		const dib = buffer.at(0);

		result.encryption = (dib & 0x1) === 1;
		result.BTHomeVersion = dib >> 5;

		if (result.BTHomeVersion !== 2) return null;
		if (result.encryption === true) return result;

		buffer = buffer.slice(1);

		while (buffer.length > 0) {

			const bth = btHomeData[buffer.at(0)];

			if (typeof bth === "undefined") {
				console.log("BTH: Unknown type");
				break;
			}

			buffer = buffer.slice(1);

			let value = this.getBufValue(bth.t, buffer);

			if (value === null) break;

			if (typeof bth.f !== "undefined") value *= bth.f;

			if (typeof result[bth.n] === "undefined") {

				result[bth.n] = value;

			} else if (Array.isArray(result[bth.n])) {

				result[bth.n].push(value);

			} else {

				result[bth.n] = [result[bth.n], value];
			}

			buffer = buffer.slice(getByteSize(bth.t));
		}

		return result;
	}
};

/**
 * main Methods
 *
 * metodi principali.
 */

const btHomeSvcIdStr = "fcd2";
const mqttQos = 1;
const mqttRetain = true;

// keep the latest known values for each device. BTHome advertisements may contain only a subset of the sensor data.
// le pubblicita' BTHome possono contenere solo una parte dei dati del sensore. mantiene gli ultimi valori noti per ciascun dispositivo.
const lastServiceData = {};

/**
 * bluetooth scan options
 *
 * opzioni di scansione bluetooth.
 */
const scanOption = {

	"duration_ms": BLE.Scanner.INFINITE_SCAN,
	"active": false
};

/**
 * push BLE devices to MQTT using the device MAC address as topic
 *
 * invia i dati dei dispositivi BLE a MQTT usando l'indirizzo MAC del dispositivo come topic
 */
const pushToMq = function(addr, message) {

	if (MQTT.isConnected() === false) {
		return false;
	}

	return MQTT.publish(addr, message, mqttQos, mqttRetain);
};

/**
 * BLE scan callback
 *
 * callback della scansione BLE
*/
const scanCallback = function(ev, res) {

	if (ev !== BLE.Scanner.SCAN_RESULT) return;
	if (typeof res.service_data === "undefined") return;
	if (typeof res.service_data[btHomeSvcIdStr] === "undefined") return;
	if (typeof res.addr === "undefined") return;

	const addr = res.addr.toLowerCase();

	// ignore BLU devices not assigned to this gateway
	// ignora i dispositivi BLU non assegnati a questo gateway
	if (allowedDeviceList[addr] !== true) return;

	try {

		const decodedData = btHomeDecoder.unpack(res.service_data[btHomeSvcIdStr]);

		if (decodedData === null) return;

		// merge the current advertisement with the latest known values
		// unisci la pubblicita' corrente con gli ultimi valori noti
		if (typeof lastServiceData[addr] === "undefined") {

			lastServiceData[addr] = {};
		}

		for (const key in decodedData) {

			lastServiceData[addr][key] = decodedData[key];
		}

		// do not overwrite the retained MQTT message with an incomplete advertisement before the window state is known
		// non sovrascrive il messaggio MQTT retained con una pubblicita' incompleta prima di conoscere lo stato della finestra
		if (typeof lastServiceData[addr].window === "undefined") return;

		const postMessage = {
			"addr": addr,
			"rssi": res.rssi,
			"local_name": res.local_name || "",
			"service_data": lastServiceData[addr]
		};

		pushToMq(addr, JSON.stringify(postMessage));

	} catch (err) {

		console.log(err);
	}
};

const init = function() {

	const bleConfig = Shelly.getComponentConfig("ble");

	// older firmware exposes ble.enable; newer firmware starts scanning on demand
	// il firmware meno recente espone ble.enable; quello piu' recente avvia la scansione quando necessario
	if (typeof bleConfig.enable !== "undefined" && bleConfig.enable === false) {

		console.log("Error: The Bluetooth is not enabled, please enable it from settings");
		return;
	}

	if (BLE.Scanner.isRunning()) {

		console.log("Info: The BLE gateway is running, the BLE scan configuration is managed by the device");

	} else {

		const bleScanner = BLE.Scanner.Start(scanOption);

		if (!bleScanner) {

			console.log("Error: Can not start new scanner");
			return;
		}
	}

	BLE.Scanner.Subscribe(scanCallback);
};

init();
