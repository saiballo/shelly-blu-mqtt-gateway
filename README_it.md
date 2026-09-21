# Shelly BLU Door/Window to Home Assistant via MQTT

[English](README.md) | [**Italiano**](README_it.md)

> Script per usare un dispositivo Shelly come gateway Bluetooth dei sensori Shelly BLU Door/Window e inoltrare lo stato di porte e finestre a Home Assistant attraverso MQTT.

![](https://img.shields.io/badge/Home%20Assistant-MQTT-18BCF2)
![](https://img.shields.io/badge/Shelly-BLU%20Gateway-4495D1)
![](https://img.shields.io/badge/Made%20with-JavaScript-F7DF1E)

## Perché è stato creato

Questo script nasce per aggirare un problema osservato nella gestione standard dei sensori Shelly BLU Door/Window in Home Assistant.

Quando una porta o una finestra viene aperta e richiusa molto rapidamente, in genere in meno di circa 3 secondi, può accadere che Home Assistant riceva l'apertura ma non registri l'ultimo stato di chiusura. L'entità rimane quindi visualizzata come aperta anche se il sensore è fisicamente chiuso, mentre nell'app Shelly lo stato risulta corretto.

Lo script sposta la ricezione Bluetooth su un dispositivo Shelly vicino ai sensori. Il gateway intercetta gli advertising BTHome, li decodifica e li inoltra tramite Wi-Fi a un broker MQTT, dal quale Home Assistant può leggere lo stato aggiornato.

```text
Shelly BLU Door/Window → gateway Shelly → broker MQTT → Home Assistant
```

## Funzionamento

Lo script:

- ascolta gli advertising Bluetooth BTHome ricevuti dal gateway Shelly;
- accetta solo i sensori elencati in `allowedDeviceList`;
- decodifica lo stato della porta o finestra e gli altri valori disponibili;
- unisce gli advertising parziali agli ultimi valori noti del sensore;
- pubblica un messaggio JSON su un topic MQTT corrispondente al MAC del sensore;
- usa QoS 1 e messaggi retained, così Home Assistant può recuperare l'ultimo stato ricevuto anche dopo un riavvio.

## Requisiti

- Home Assistant con l'integrazione MQTT già configurata e collegata a un broker;
- un broker MQTT raggiungibile sia da Home Assistant sia dal gateway Shelly;
- un dispositivo Shelly compatibile con scripting e scansione Bluetooth, configurato come gateway BLU;
- uno o più sensori Shelly BLU Door/Window non cifrati.

Questo README non descrive l'installazione del broker o dell'integrazione MQTT in Home Assistant.

## Configurazione in Home Assistant

Lo script pubblica gli stati sul broker, ma non pubblica automaticamente la configurazione MQTT Discovery. Per ogni porta o finestra bisogna quindi inviare una sola volta il relativo messaggio Discovery retained.

Questo metodo è più comodo rispetto alla configurazione statica in `configuration.yaml` perché:

- non richiede di modificare file di Home Assistant;
- non richiede un riavvio;
- crea il dispositivo e la relativa entità nel registro MQTT;
- permette di includere nome, modello, produttore e numero seriale;
- conserva la configurazione nel broker grazie al flag retained.

In Home Assistant aprire **Strumenti per sviluppatori → Azioni**, selezionare `mqtt.publish`, passare alla modalità YAML e pubblicare una configurazione come questa:

```yaml
action: mqtt.publish
data:
  topic: homeassistant/binary_sensor/shelly_blu_MACADDRESS_window/config
  qos: 1
  retain: true
  payload: >-
    {
      "name": "Finestra studio MQTT",
      "default_entity_id": "binary_sensor.finestra_studio_mqtt",
      "unique_id": "shelly_blu_MACADDRESS_window",
      "state_topic": "MAC:ADDRESS",
      "value_template": "{% raw %}{{ value_json.service_data.window }}{% endraw %}",
      "payload_on": "1",
      "payload_off": "0",
      "device_class": "window",
      "qos": 1,
      "device": {
        "identifiers": ["shelly_blu_MACADDRESS"],
        "name": "Finestra studio MQTT",
        "manufacturer": "Shelly",
        "model": "SBDW-002C",
        "serial_number": "MAC:ADDRESS"
      },
      "origin": {
        "name": "universal-blu-to-mqtt"
      }
    }
```

Adattare nome, MAC, topic Discovery, `default_entity_id`, `unique_id`, identificatore e numero seriale a ciascun sensore. Per una porta usare `device_class: "door"`; per una finestra usare `device_class: "window"`.

I tag `{% raw %}` ed `{% endraw %}` impediscono a Home Assistant di valutare `value_json` mentre viene eseguita l'azione. Nel messaggio Discovery verrà salvato correttamente il template destinato all'entità MQTT.

Questa operazione deve essere eseguita una volta per ogni sensore porta o finestra, personalizzando tutti i valori indicati nell’esempio.

### Perché il suffisso `_mqtt`

Durante la migrazione erano già presenti in Home Assistant i dispositivi e le entità creati dall'integrazione BTHome. Il suffisso `_mqtt` è stato aggiunto intenzionalmente ai nuovi nomi e agli `entity_id` per:

- distinguere immediatamente la nuova entità MQTT da quella BTHome esistente;
- evitare collisioni tra gli `entity_id`;
- confrontare i due percorsi durante i test;
- aggiornare dashboard e automazioni senza rischiare di usare la sorgente sbagliata.

Ovviamente è possibile scegliere il suffisso che si vuole.

Il suffisso può essere mantenuto anche dopo la migrazione, perché rende evidente che lo stato arriva tramite MQTT. Se le vecchie entità BTHome vengono rimosse, può essere eliminato rinominando le entità dalla relativa pagina di Home Assistant.

Grazie al messaggio retained, Home Assistant riceve l'ultimo stato memorizzato non appena si collega al broker.

Per controllare le configurazioni Discovery memorizzate, dall'integrazione MQTT di Home Assistant ascoltare:

```text
homeassistant/binary_sensor/+/config
```

## Personalizzazione dello script

Aprire `universal-blu-to-mqtt.shelly.js` e modificare esclusivamente `allowedDeviceList`, inserendo i MAC dei sensori che devono essere gestiti dal gateway:

```javascript
const allowedDeviceList = {
	// porta ingresso
	"aa:bb:cc:dd:ee:01": true,
	// finestra soggiorno
	"aa:bb:cc:dd:ee:02": true
};
```

Indicazioni importanti:

- scrivere i MAC in minuscolo;
- mantenere il valore `true`;
- assegnare ogni sensore a un solo gateway;
- non inserire nello stesso script dispositivi che devono essere gestiti da un altro gateway.

L'assegnazione esclusiva evita che più gateway pubblichino contemporaneamente sullo stesso topic retained.

## Configurazione MQTT del gateway Shelly

Nell'interfaccia web del dispositivo Shelly che fungerà da gateway, abilitare MQTT e configurare:

| Impostazione | Valore consigliato |
| --- | --- |
| Connection type | `No TLS`, se il broker è nella LAN fidata e non è configurato per TLS |
| Server | IP o hostname del broker MQTT e porta, ad esempio `IP_DEL_BROKER:1883` |
| Client ID | un nome univoco, ad esempio `shelly-blu-gateway-salotto` |
| Username | l'utente MQTT dedicato ai gateway Shelly |
| Password | la password dell'utente MQTT |
| MQTT prefix | un prefisso univoco, ad esempio `shelly-blu-gateway-salotto` |

Il prefisso riguarda i topic MQTT nativi del dispositivo Shelly; i topic pubblicati esplicitamente dallo script restano i MAC dei sensori.

Per questa configurazione non sono necessarie le funzioni MQTT native di controllo o notifica del dispositivo. Lasciare disabilitate, se presenti:

- Enable MQTT Control;
- Enable RPC over MQTT;
- RPC status notifications over MQTT;
- Generic status update over MQTT.

L'uso di `No TLS` è adatto a una rete locale fidata. Non esporre la porta MQTT non cifrata direttamente su Internet.

Ogni gateway deve avere un Client ID e un MQTT prefix differenti. Più gateway con lo stesso Client ID possono disconnettersi a vicenda dal broker.

## Installazione dello script sul gateway

1. Accedere all'interfaccia web del gateway Shelly.
2. Aprire la sezione **Scripts** e creare un nuovo script.
3. Incollare il contenuto di `universal-blu-to-mqtt.shelly.js` dopo aver personalizzato `allowedDeviceList`.
4. Salvare lo script.
5. Abilitare **Run on startup**.
6. Avviare lo script.

Se il gateway Bluetooth è già attivo, nella console può comparire:

```text
Info: The BLE gateway is running, the BLE scan configuration is managed by the device
```

Il messaggio è informativo e non indica un errore.

## Verifica

Dal pannello MQTT di Home Assistant, o tramite un client MQTT, ascoltare il topic corrispondente al MAC del sensore. Aprendo e chiudendo rapidamente la porta o finestra devono arrivare in sequenza:

```text
"window": 1
"window": 0
```

Verificare inoltre che il `pid` cambi tra i due advertising.

## Limitazioni

- Lo script supporta payload BTHome versione 2 non cifrati.
- Non pubblica MQTT Discovery: le entità Home Assistant devono essere configurate separatamente.
- Non pubblica un topic di availability; in sua assenza Home Assistant considera l'entità disponibile.
- Il messaggio retained conserva soltanto l'ultimo stato già ricevuto dal broker. Non può recuperare un evento avvenuto mentre il gateway, la rete Wi-Fi o il broker erano offline.
- Il nome locale del sensore può essere vuoto: il MAC resta l'identificatore usato dal topic.

## Progetto di partenza

Il progetto deriva dall'esempio ufficiale [Universal BLU to MQTT Script](https://github.com/ALLTERCO/shelly-script-examples/blob/main/ble/universal-blu-to-mqtt.shelly.js) di Shelly/ALLTERCO, successivamente adattato per:

- filtrare i dispositivi assegnati a ciascun gateway;
- mantenere gli ultimi valori noti quando gli advertising sono parziali;
- evitare di sovrascrivere lo stato retained prima di conoscere il valore della finestra;
- usare QoS 1 e retained messages;
- supportare firmware che non espongono più la proprietà `ble.enable`.

Il repository originale è distribuito con licenza Apache 2.0. In caso di pubblicazione o redistribuzione, conservare le attribuzioni richieste e includere una copia della licenza.

## Autore

**Lorenzo "Saibal" Forti** - <lorenzo.forti@gmail.com>
