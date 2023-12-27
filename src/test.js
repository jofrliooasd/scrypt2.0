import http from 'http';
import mqtt from 'mqtt';
import { Client } from 'pg';

// Configurar la conexión MQTT
const mqttOptions = {
  username: 'UG67',
  password: '5599lm',
};

const mqttClient = mqtt.connect('mqtt://18.216.32.109:1883', mqttOptions);

// Configurar la conexión a la base de datos PostgreSQL con Client
const client = new Client({
    user: 'django_backend_qas',
    host: 'agvpgsql.cd0jfjeqc6yz.us-east-1.rds.amazonaws.com',
    database: 'smartagro_qas',
    password: '7NgXw!uH.Kcay9M',
    port: 5432,
  });
  
client.connect()
  .then(() => console.log('Conexión establecida con la base de datos'))
  .catch(error => console.error('No se pudo conectar a la base de datos:', error));

const servidor = http.createServer((req, res) => {
  const clienteDireccionIP = req.connection.remoteAddress;
  let data = '';

  req.on('data', (chunk) => {
    data += chunk;
  });

  req.on('end', async () => {
    try {
      const jsonData = JSON.parse(data);

      if (jsonData.hasOwnProperty('data')) {
        const dataBase64 = jsonData.data;
        const dataBuffer = Buffer.from(dataBase64, 'base64');
        const dataHex = dataBuffer.toString('hex');

        jsonData.data = dataHex;

        console.log(`recepcion desde IP: ${clienteDireccionIP}`);

        const reformateo = {
          dr: {
            bandwidth: jsonData.txInfo.dataRate.bandwidth,
            modulation: jsonData.txInfo.dataRate.modulation,
            spreadFactor: jsonData.txInfo.dataRate.spreadFactor,
          },
          idGtway: jsonData.rxInfo.map(rxInfoObj => rxInfoObj.mac),
          adr: jsonData.txInfo.adr,
          ubi: {
            lat: (jsonData.rxInfo.length > 0) ? jsonData.rxInfo[0].latitude : null,
            long: (jsonData.rxInfo.length > 0) ? jsonData.rxInfo[0].longitude : null,
            alt: (jsonData.rxInfo.length > 0) ? jsonData.rxInfo[0].altitude : null
          },
          freq: (jsonData.txInfo) ? (jsonData.txInfo.frequency / 1000000).toFixed(1) : null,
          snr: (jsonData.rxInfo && jsonData.rxInfo[0]) ? jsonData.rxInfo[0].loRaSNR.toString() : null,
          rssi: (jsonData.rxInfo && jsonData.rxInfo[0]) ? jsonData.rxInfo[0].rssi : null,
          time: jsonData.time,
          fcnt: jsonData.fCnt,
          fport: jsonData.fPort,
          payload: jsonData.data,
          deveui: jsonData.devEUI,
        };

        const { deveui, idGtway, ubi } = reformateo;
        const deveuiString = String(deveui);
        const idGtwayString = idGtway.map(mac => String(mac)).join(', ');
        const ubiString = String(ubi);
        console.log(ubiString);

        const { fport, payload } = reformateo;
        const result = Decoder(payload.match(/.{1,2}/g).map(byte => parseInt(byte, 16)), fport);

        const jsonString = JSON.stringify(result);
        const adc_object = JSON.parse(jsonString);
        const adc_2_value = adc_object.adc_2;

        const Vex = 8.92;
        const C = 11000;

        const microns_D = (adc_2_value / Vex) * C;
        const milimetros = parseFloat((microns_D / 1000).toFixed(4));

        console.log('diametro en micrometros', microns_D);
        console.log('diametro en milimetros:', milimetros);

        // Inserción en la base de datos PostgreSQL
        // Obtén la fecha y hora actual en la zona horaria 'America/Lima'
        var now = new Date();
        var limaTimeZone = 'America/Lima';
        var options = { timeZone: limaTimeZone, hour12: false };
        var tiempo = now.toLocaleString('es-PE', options);

        // Imprime la fecha y hora actual
        console.log(tiempo);
        var fecha_hora_actual = "NOW()";
        const keyTipoProyectoId = 1;

        const insertQuery = `INSERT INTO sensor_proyecto (cod_gatw, codigo_nodo, fecha_hora, d_um, d_mm, key_tipo_proyecto_id) VALUES ('${idGtwayString}','${deveuiString}', '${fecha_hora_actual}', ${microns_D}, ${milimetros}, ${keyTipoProyectoId});`;

        const values = [idGtwayString, deveuiString, microns_D, milimetros, keyTipoProyectoId];
        console.log (values);
        
        const performInsertion = async () => {
            try {
              const result = await client.query(insertQuery);
        
              console.log('Inserción exitosa. Result:', result.rows);
        
            } catch (error) {
              console.error('Error durante la inserción:', error);
              console.error('Error SQL:', error.message);
            }
          };
        
          // Espera 2 minutos antes de realizar la inserción
          setTimeout(performInsertion, 45 * 60 * 1000); // 2 minutos 

        mqttClient.publish('sw/send', JSON.stringify(result));
        mqttClient.publish('sw/query', JSON.stringify(values));
        mqttClient.publish('sw/ub', JSON.stringify(ubiString));
        //console.log('reenviando por mqtt...');

      } else {
        console.warn(`El campo "data" no está presente en los datos recibidos desde ${clienteDireccionIP}.`);
      }
    } catch (error) {
      console.error(`Error en recepción desde ${clienteDireccionIP}: ${error.message}`);
      console.error('Error al procesar el mensaje:', error);
    }
  });

  req.on('error', (error) => {
    console.error(`Error en la solicitud desde ${clienteDireccionIP}: ${error.message}`);
  });
});

const puerto = 3006;

servidor.listen(puerto, () => {
  console.log(`Servidor escuchando en http://:${puerto}/`);
});

//DECODER

function Decoder(bytes, fport) {
  return milesight(bytes);
}

let gpio_chns = [0x03, 0x04];
let adc_chns = [0x05, 0x06];
let adc_alert_chns = [0x85, 0x86];

function milesight(bytes) {
  var decoded = {};

  for (let i = 0; i < bytes.length; ) {
      var channel_id = bytes[i++];
      var channel_type = bytes[i++];

      // BATTERY
      if (channel_id === 0x01 && channel_type === 0x75) {
          decoded.battery = bytes[i];
          i += 1;
      }
      // GPIO (GPIO as Digital Input or Output)
      else if (includes(gpio_chns, channel_id) && (channel_type === 0x00 || channel_type === 0x01)) {
          var gpio_channel_name = "gpio_" + (channel_id - gpio_chns[0] + 1);
          decoded[gpio_channel_name] = bytes[i] === 0 ? "low" : "high";
          i += 1;
      }
      //  GPIO (GPIO as PULSE COUNTER)
      else if (includes(gpio_chns, channel_id) && channel_type === 0xc8) {
          var gpio_channel_name = "counter_" + (channel_id - gpio_chns[0] + 1);
          decoded[gpio_channel_name] = readUInt32LE(bytes.slice(i, i + 4));
          i += 4;
      }
      // ADC (UC50x v2)
      // firmware version 1.10 and below and UC50x V1, change 1000 to 100.
      else if (includes(adc_chns, channel_id) && channel_type === 0x02) {
          var adc_channel_name = "adc_" + (channel_id - adc_chns[0] + 1);
          decoded[adc_channel_name] = readInt16LE(bytes.slice(i, i + 2)) / 1000;
          decoded[adc_channel_name + "_min"] = readInt16LE(bytes.slice(i + 2, i + 4)) / 1000;
          decoded[adc_channel_name + "_max"] = readInt16LE(bytes.slice(i + 4, i + 6)) / 1000;
          decoded[adc_channel_name + "_avg"] = readInt16LE(bytes.slice(i + 6, i + 8)) / 1000;
          i += 8;
      }
      // ADC (UC50x v3)
      else if (includes(adc_chns, channel_id) && channel_type === 0xe2) {
          var adc_channel_name = "adc_" + (channel_id - adc_chns[0] + 1);
          decoded[adc_channel_name] = readFloat16LE(bytes.slice(i, i + 2));
          decoded[adc_channel_name + "_min"] = readFloat16LE(bytes.slice(i + 2, i + 4));
          decoded[adc_channel_name + "_max"] = readFloat16LE(bytes.slice(i + 4, i + 6));
          decoded[adc_channel_name + "_avg"] = readFloat16LE(bytes.slice(i + 6, i + 8));
          i += 8;
      }
      // SDI-12
      else if (channel_id === 0x08 && channel_type === 0xdb) {
          var name = "sdi12_" + (bytes[i++] + 1);
          decoded[name] = readString(bytes.slice(i, i + 36));
          i += 36;
      }
      // MODBUS
      else if ((channel_id === 0xff || channel_id === 0x80) && channel_type === 0x0e) {
          var modbus_chn_id = bytes[i++] - 6;
          var package_type = bytes[i++];
          var data_type = package_type & 0x07; // 0x07 = 0b00000111
          var date_length = package_type >> 3;
          var chn = "chn_" + modbus_chn_id;
          switch (data_type) {
              case 0:
                  decoded[chn] = bytes[i] ? "on" : "off";
                  i += 1;
                  break;
              case 1:
                  decoded[chn] = bytes[i];
                  i += 1;
                  break;
              case 2:
              case 3:
                  decoded[chn] = readUInt16LE(bytes.slice(i, i + 2));
                  i += 2;
                  break;
              case 4:
              case 6:
                  decoded[chn] = readUInt32LE(bytes.slice(i, i + 4));
                  i += 4;
                  break;
              case 5:
              case 7:
                  decoded[chn] = readFloatLE(bytes.slice(i, i + 4));
                  i += 4;
                  break;
          }

          if (channel_id === 0x80) {
              var alert = bytes[i++];
              switch (alert) {
                  case 1: // THRESHOLD ALERT
                      decoded[chn + "_alert"] = "threshold";
                      break;
                  case 2: // VALUE CHANGE ALERT
                      decoded[chn + "_alert"] = "value change";
                      break;
                  default:
                      decoded[chn + "_alert"] = "none";
              }
          }
      }
      // MODBUS READ ERROR
      else if (channel_id === 0xff && channel_type === 0x15) {
          var modbus_error_chn_id = bytes[i] - 6;
          var channel_name = "chn_" + modbus_error_chn_id + "_alert";
          decoded[channel_name] = "read error";
          i += 1;
      }
      // ADC alert (UC50x v3)
      else if (includes(adc_alert_chns, channel_id) && channel_type === 0xe2) {
          var adc_channel_name = "adc_" + (channel_id - adc_alert_chns[0] + 1);
          decoded[adc_channel_name] = readFloat16LE(bytes.slice(i, i + 2));
          decoded[adc_channel_name + "_min"] = readFloat16LE(bytes.slice(i + 2, i + 4));
          decoded[adc_channel_name + "_max"] = readFloat16LE(bytes.slice(i + 4, i + 6));
          decoded[adc_channel_name + "_avg"] = readFloat16LE(bytes.slice(i + 6, i + 8));
          i += 8;

          var alert = bytes[i++];
          switch (alert) {
              case 1: // THRESHOLD ALERT
                  decoded[adc_channel_name + "_alert"] = "threshold";
                  break;
              case 2: // VALUE CHANGE ALERT
                  decoded[adc_channel_name + "_alert"] = "value change";
                  break;
              default:
                  decoded[adc_channel_name + "_alert"] = "none";
                  break;
          }
      }
      // HISTORY DATA (GPIO / ADC)
      else if (channel_id === 0x20 && channel_type === 0xdc) {
          var timestamp = readUInt32LE(bytes.slice(i, i + 4));

          var data = { timestamp: timestamp };
          data.gpio_1 = readUInt32LE(bytes.slice(i + 5, i + 9));
          data.gpio_2 = readUInt32LE(bytes.slice(i + 10, i + 14));
          data.adc_1 = readInt32LE(bytes.slice(i + 14, i + 18)) / 1000;
          data.adc_2 = readInt32LE(bytes.slice(i + 18, i + 22)) / 1000;
          i += 22;

          decoded.history = decoded.history || [];
          decoded.history.push(data);
      }
      // HISTORY DATA (SDI-12)
      else if (channel_id === 0x20 && channel_type === 0xe0) {
          var timestamp = readUInt32LE(bytes.slice(i, i + 4));
          var channel_mask = numToBits(readUInt16LE(bytes.slice(i + 4, i + 6)), 16);
          i += 6;

          var data = { timestamp: timestamp };
          for (j = 0; j < channel_mask.length; j++) {
              // skip if channel is not enabled
              if (channel_mask[j] === 0) continue;
              var name = "sdi12_" + (j + 1);
              data[name] = readString(bytes.slice(i, i + 36));
              i += 36;
          }

          decoded.history = decoded.history || [];
          decoded.history.push(data);
      }
      // HISTORY DATA (MODBUS)
      else if (channel_id === 0x20 && channel_type === 0xdd) {
          decoded.history = decoded.history || [];

          var timestamp = readUInt32LE(bytes.slice(i, i + 4));
          var channel_mask = numToBits(readUInt16LE(bytes.slice(i + 4, i + 6)), 16);
          i += 6;

          var data = { timestamp: timestamp };
          for (j = 0; j < channel_mask.length; j++) {
              // skip if channel is not enabled
              if (channel_mask[j] === 0) continue;

              var name = "modbus_chn_" + (j + 1);
              var type = bytes[i++] & 0x07; // 0x07 = 0b00000111
              // 5 MB_REG_HOLD_FLOAT, 7 MB_REG_INPUT_FLOAT
              if (type === 5 || type === 7) {
                  data[name] = readFloatLE(bytes.slice(i, i + 4));
              } else {
                  data[name] = readUInt32LE(bytes.slice(i, i + 4));
              }

              i += 4;
          }

          decoded.history = decoded.history || [];
          decoded.history.push(data);
      } else {
          break;
      }
  }

  return decoded;
}

/* ******************************************
* bytes to number
********************************************/
function numToBits(num, bit_count) {
  var bits = [];
  for (let i = 0; i < bit_count; i++) {
      bits.push((num >> i) & 1);
  }
  return bits;
}

function readUInt8(bytes) {
  return bytes & 0xff;
}

function readInt8(bytes) {
  var ref = readUInt8(bytes);
  return ref > 0x7f ? ref - 0x100 : ref;
}

function readUInt16LE(bytes) {
  var value = (bytes[1] << 8) + bytes[0];
  return value & 0xffff;
}

function readInt16LE(bytes) {
  var ref = readUInt16LE(bytes);
  return ref > 0x7fff ? ref - 0x10000 : ref;
}

function readUInt32LE(bytes) {
  var value = (bytes[3] << 24) + (bytes[2] << 16) + (bytes[1] << 8) + bytes[0];
  return value & 0xffffffff;
}

function readInt32LE(bytes) {
  var ref = readUInt32LE(bytes);
  return ref > 0x7fffffff ? ref - 0x100000000 : ref;
}

function readFloat16LE(bytes) {
  var bits = (bytes[1] << 8) | bytes[0];
  var sign = bits >>> 15 === 0 ? 1.0 : -1.0;
  var e = (bits >>> 10) & 0x1f;
  var m = e === 0 ? (bits & 0x3ff) << 1 : (bits & 0x3ff) | 0x400;
  var f = sign * m * Math.pow(2, e - 25);
  return f;
}

function readFloatLE(bytes) {
  var bits = (bytes[3] << 24) | (bytes[2] << 16) | (bytes[1] << 8) | bytes[0];
  var sign = bits >>> 31 === 0 ? 1.0 : -1.0;
  var e = (bits >>> 23) & 0xff;
  var m = e === 0 ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
  var f = sign * m * Math.pow(2, e - 150);
  return f;
}

function readString(bytes) {
  var str = "";
  for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) {
          break;
      }
      str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function includes(datas, value) {
  var size = datas.length;
  for (var i = 0; i < size; i++) {
      if (datas[i] == value) {
          return true;
      }
  }
  return false;
}
        
