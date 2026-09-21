# Shelly BLU Door/Window to Home Assistant via MQTT

[**English**](README.md) | [Italiano](README_it.md)

> Script that uses a Shelly device as a Bluetooth gateway for Shelly BLU Door/Window sensors and forwards door and window states to Home Assistant through MQTT.

![](https://img.shields.io/badge/Home%20Assistant-MQTT-18BCF2)
![](https://img.shields.io/badge/Shelly-BLU%20Gateway-4495D1)
![](https://img.shields.io/badge/Made%20with-JavaScript-F7DF1E)

## Why it was created

This script was created to work around an issue observed when using Shelly BLU Door/Window sensors with the standard Home Assistant setup.

When a door or window is opened and closed very quickly, usually within approximately 3 seconds, Home Assistant may receive the opening event but fail to record the final closed state. The entity therefore remains displayed as open even though the physical sensor is closed, while the Shelly app reports the correct state.

The script moves Bluetooth reception to a Shelly device located near the sensors. The gateway receives the BTHome advertisements, decodes them, and forwards them over Wi-Fi to an MQTT broker, from which Home Assistant can read the updated state.

```text
Shelly BLU Door/Window → Shelly gateway → MQTT broker → Home Assistant
```

## How it works

The script:

- listens for BTHome Bluetooth advertisements received by the Shelly gateway;
- accepts only the sensors listed in `allowedDeviceList`;
- decodes the door or window state and the other available values;
- merges partial advertisements with the latest known values for the sensor;
- publishes a JSON message to an MQTT topic matching the sensor MAC address;
- uses QoS 1 and retained messages, allowing Home Assistant to recover the latest received state after a restart.

## Requirements

- Home Assistant with the MQTT integration already configured and connected to a broker;
- an MQTT broker reachable by both Home Assistant and the Shelly gateway;
- a Shelly device that supports scripting and Bluetooth scanning, configured as a BLU gateway;
- one or more unencrypted Shelly BLU Door/Window sensors.

This README does not cover installation of the MQTT broker or the MQTT integration in Home Assistant.

## Home Assistant configuration

The script publishes sensor states to the broker, but it does not automatically publish the MQTT Discovery configuration. The corresponding retained Discovery message must therefore be sent once for each door or window.

This method is more convenient than a static configuration in `configuration.yaml` because it:

- does not require editing Home Assistant files;
- does not require a restart;
- creates the device and its entity in the MQTT registry;
- can include the device name, model, manufacturer, and serial number;
- preserves the configuration in the broker through the retained flag.

In Home Assistant, open **Developer Tools → Actions**, select `mqtt.publish`, switch to YAML mode, and publish a configuration such as the following:

```yaml
action: mqtt.publish
data:
  topic: homeassistant/binary_sensor/shelly_blu_MACADDRESS_window/config
  qos: 1
  retain: true
  payload: >-
    {
      "name": "Office window MQTT",
      "default_entity_id": "binary_sensor.office_window_mqtt",
      "unique_id": "shelly_blu_MACADDRESS_window",
      "state_topic": "MAC:ADDRESS",
      "value_template": "{% raw %}{{ value_json.service_data.window }}{% endraw %}",
      "payload_on": "1",
      "payload_off": "0",
      "device_class": "window",
      "qos": 1,
      "device": {
        "identifiers": ["shelly_blu_MACADDRESS"],
        "name": "Office window MQTT",
        "manufacturer": "Shelly",
        "model": "SBDW-002C",
        "serial_number": "MAC:ADDRESS"
      },
      "origin": {
        "name": "universal-blu-to-mqtt"
      }
    }
```

Change the name, MAC address, Discovery topic, `default_entity_id`, `unique_id`, identifier, and serial number for each sensor. Use `device_class: "door"` for a door and `device_class: "window"` for a window.

The `{% raw %}` and `{% endraw %}` tags prevent Home Assistant from evaluating `value_json` while the action is being executed. The template intended for the MQTT entity will be stored correctly in the Discovery message.

This operation must be performed once for each door or window sensor, customizing all the values highlighted in the example.

### Why the `_mqtt` suffix is used

During the migration, devices and entities created by the BTHome integration were already present in Home Assistant. The `_mqtt` suffix was intentionally added to the new names and entity IDs in order to:

- immediately distinguish the new MQTT entity from the existing BTHome entity;
- prevent entity ID collisions;
- compare the two data paths during testing;
- update dashboards and automations without accidentally using the wrong source.

You may of course choose any suffix you prefer.

The suffix can also be kept after the migration because it makes the MQTT source explicit. If the old BTHome entities are removed, the suffix can be dropped by renaming the entities from their Home Assistant entity pages.

Because the state message is retained, Home Assistant receives the latest stored state as soon as it connects to the broker.

To inspect the stored Discovery configurations, listen to the following topic from the Home Assistant MQTT integration:

```text
homeassistant/binary_sensor/+/config
```

## Customizing the script

Open `universal-blu-to-mqtt.shelly.js` and edit only `allowedDeviceList`, adding the MAC addresses of the sensors that must be managed by the gateway:

```javascript
const allowedDeviceList = {
	// front door
	"aa:bb:cc:dd:ee:01": true,
	// living room window
	"aa:bb:cc:dd:ee:02": true
};
```

Important guidelines:

- enter MAC addresses in lowercase;
- keep the value set to `true`;
- assign each sensor to only one gateway;
- do not add devices that are meant to be managed by another gateway to the same script.

Exclusive assignment prevents multiple gateways from publishing to the same retained topic at the same time.

## Shelly gateway MQTT configuration

In the web interface of the Shelly device that will act as the gateway, enable MQTT and configure the following settings:

| Setting | Recommended value |
| --- | --- |
| Connection type | `No TLS`, if the broker is on a trusted LAN and is not configured for TLS |
| Server | MQTT broker IP address or hostname and port, for example `MQTT_BROKER_IP:1883` |
| Client ID | a unique name, for example `shelly-blu-gateway-living-room` |
| Username | the MQTT user dedicated to Shelly gateways |
| Password | the password for the MQTT user |
| MQTT prefix | a unique prefix, for example `shelly-blu-gateway-living-room` |

The prefix applies to the native MQTT topics published by the Shelly device. Topics explicitly published by this script remain the sensor MAC addresses.

The native MQTT control and notification features are not required for this setup. Leave the following options disabled, if available:

- Enable MQTT Control;
- Enable RPC over MQTT;
- RPC status notifications over MQTT;
- Generic status update over MQTT.

`No TLS` is suitable for a trusted local network. Do not expose an unencrypted MQTT port directly to the Internet.

Each gateway must use a different Client ID and MQTT prefix. Multiple gateways using the same Client ID may repeatedly disconnect each other from the broker.

## Installing the script on the gateway

1. Open the Shelly gateway web interface.
2. Open the **Scripts** section and create a new script.
3. Paste the contents of `universal-blu-to-mqtt.shelly.js` after customizing `allowedDeviceList`.
4. Save the script.
5. Enable **Run on startup**.
6. Start the script.

If the Bluetooth gateway is already running, the console may display:

```text
Info: The BLE gateway is running, the BLE scan configuration is managed by the device
```

This is an informational message and does not indicate an error.

## Verification

From the Home Assistant MQTT panel, or with an MQTT client, listen to the topic matching the sensor MAC address. Quickly opening and closing the door or window should produce the following sequence:

```text
"window": 1
"window": 0
```

Also verify that the `pid` changes between the two advertisements.

## Limitations

- The script supports unencrypted BTHome version 2 payloads.
- It does not publish MQTT Discovery: Home Assistant entities must be configured separately.
- It does not publish an availability topic; without one, Home Assistant considers the entity available.
- A retained message stores only the latest state already received by the broker. It cannot recover an event that occurred while the gateway, Wi-Fi network, or broker was offline.
- The local sensor name may be empty; the MAC address remains the identifier used as the topic.

## Based on

This project is based on Shelly/ALLTERCO's official [Universal BLU to MQTT Script](https://github.com/ALLTERCO/shelly-script-examples/blob/main/ble/universal-blu-to-mqtt.shelly.js), subsequently adapted to:

- filter the devices assigned to each gateway;
- preserve the latest known values when advertisements contain only partial data;
- avoid overwriting the retained state before the window state is known;
- use QoS 1 and retained messages;
- support firmware versions that no longer expose the `ble.enable` property.

The original repository is distributed under the Apache License 2.0. When publishing or redistributing this project, retain the required attribution notices and include a copy of the license.

## Author

**Lorenzo "Saibal" Forti** - <lorenzo.forti@gmail.com>
