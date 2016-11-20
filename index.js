// WARNING - code is ugly, needs some cleanup

const ffmpeg = require('fluent-ffmpeg');
const stream = require('stream');
const geolib = require('geolib');
const fs = require('fs');
const parser = require('subtitles-parser');
const piexif = require('piexifjs');

const re = /\}A,(\d+),(\d+\.\d+),([+-]?\d\d)(\d+\.\d+),(N),([+-]?\d\d\d)(\d+\.\d+),(E),([+-]?\d+.\d+),([+-]?\d+\.\d+),([+-]?\d+\.\d+),([+-]?\d+\.\d+);/;

const w = new stream.Writable();

const chunks = [];

const input = process.argv[2];

w._write = function (chunk, encoding, done) {
  chunks.push(chunk.toString());
  done();
};

let lat, lon, time, tt;

let dist = 0;
let dist0 = 0;

let i = 0;

const cmd = [];
const positions = [];

let frame = 0;

w.on('finish', function () {
  parser.fromSrt(chunks.join('')).forEach(item => {
    const m = re.exec(item.text);
    if (m) {
      const lat1 = (m[5] === 'N' ? 1 : -1) * (parseFloat(m[3]) + parseFloat(m[4]) / 60);
      const lon1 = (m[8] === 'E' ? 1 : -1) * (parseFloat(m[6]) + parseFloat(m[7]) / 60);
      const mr = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\.(\d\d\d)$/.exec(m[1] + m[2]);
      const time1 = Date.UTC(parseInt(mr[3]) + 2000, mr[2] - 1, mr[1], mr[4], mr[5], mr[6], mr[7]);
      //const speed = parseFloat(m[9]) * 1.60934;

      const [ th, tm, ts ] = item.startTime.replace(',', '.').split(':');
      const tt1 = (parseInt(th) * 60 + parseInt(tm)) * 60 + parseFloat(ts);

      if (time && time1 !== time) {
        const d = geolib.getDistance(
          {latitude: lat, longitude: lon },
          {latitude: lat1, longitude: lon1 },
          1, 3
        );

        const oldDist = dist;
        dist += d;

        while (dist0 < dist) {
          const ratio = (dist0 - oldDist) / d;
          const timeR = time + (time1 - time) * ratio;

          const latR = lat + (lat1 - lat) * ratio;
          const lonR = lon + (lon1 - lon) * ratio;
          const ttR = tt + (tt1 - tt) * ratio;

          if (!isNaN(ttR)) {
            if (frame) {
              cmd.push(`+lt(prev_selected_t\\,${ttR.toFixed(2)})*gt(t\\,${ttR.toFixed(2)})`);
            } else {
              cmd.push(`isnan(prev_selected_t)*gt(t\\,${ttR.toFixed(2)})`);
            }
            positions.push({ lat: latR, lon: lonR, time: timeR });
            frame++;
          }

          dist0 += 5;
        }

        tt = tt1;
      }

      [ lat, lon, time ] = [ lat1, lon1, time1 ];
    } else {
      console.error('IGN', item.text);
    }
  });

  ffmpeg()
    .input(input)
    .complexFilter({
      filter: 'select',
      options: cmd.join('')
    })
    .output('tmp%04d.jpg')
    .outputOptions('-y', '-vsync', 'vfr', '-vframes', frame)
    .on('start', function (commandLine) {
      console.log('Spawned Ffmpeg with command: ' + commandLine);
    })
    .on('end', function () {
      for (let i = 0; i < frame; i++) {
        const tmpFilename = `tmp${('0000' + (i + 1)).slice(-4)}.jpg`;

        const jpeg = fs.readFileSync(tmpFilename);
        const data = jpeg.toString('binary');
        const exifObj = piexif.load(data);

        const { lat, lon, time } = positions[i];

        const date = new Date(time);

        exifObj['GPS'][piexif.GPSIFD.GPSVersionID] = [2, 0, 0, 0];
        exifObj['GPS'][piexif.GPSIFD.GPSLatitudeRef] = lat < 0 ? 'S' : 'N';
        exifObj['GPS'][piexif.GPSIFD.GPSLatitude] = degToDmsRational(lat);
        exifObj['GPS'][piexif.GPSIFD.GPSLongitudeRef] = lon < 0 ? 'W' : 'E';
        exifObj['GPS'][piexif.GPSIFD.GPSLongitude] = degToDmsRational(lon);
        exifObj['GPS'][piexif.GPSIFD.GPSTimeStamp] = [ [ date.getUTCHours(), 1 ], [ date.getUTCMinutes(), 1 ], [ Math.round(date.getUTCSeconds() * 1000 + date.getUTCMilliseconds()), 1000 ] ];
        exifObj['GPS'][piexif.GPSIFD.GPSDateStamp] = `${date.getUTCFullYear()}:${date.getUTCMonth() + 1}:${date.getUTCDate()}`;

        if (i > 0 && i < frame - 1) {
          const bearing1 = geolib.getRhumbLineBearing(
            { latitude: positions[i - 1].lat, longitude: positions[i - 1].lon },
            { latitude: lat, longitude: lon }
          );

          const bearing2 = geolib.getRhumbLineBearing(
            { latitude: lat, longitude: lon },
            { latitude: positions[i + 1].lat, longitude: positions[i + 1].lon }
          );

          const bearing = Math.atan2((Math.sin(bearing1 / 180 * Math.PI) + Math.sin(bearing2 / 180 * Math.PI)),
            (Math.cos(bearing1 / 180 * Math.PI) + Math.cos(bearing2 / 180 * Math.PI))) / Math.PI * 180;

          exifObj['GPS'][piexif.GPSIFD.GPSImgDirectionRef] = 'T';
          exifObj['GPS'][piexif.GPSIFD.GPSImgDirection] = [ [ Math.round(((bearing + 360) % 360) * 100), 100] ];
        }

        const newData = piexif.insert(piexif.dump(exifObj), data);
        const newJpeg = new Buffer(newData, 'binary');
        fs.writeFileSync(`img${('0000' + (i + 1)).slice(-4)}.jpg`, newJpeg);
        fs.unlinkSync(tmpFilename);
      }
    })
    .run();
});

ffmpeg()
  .input(input)
  .output(w).format('srt')
  .run();

function formatTime(ms) {
  const h = Math.floor(ms / 3600);
  const m = Math.floor((ms - h * 3600) / 60);
  const s = (ms - h * 3600 - m * 60).toFixed(2);
  return `${h}:${m}:${s}`;
}


function degToDmsRational(degFloat) {
  const minFloat = degFloat % 1 * 60
  const secFloat = minFloat % 1 * 60
  const deg = Math.floor(degFloat)
  const min = Math.floor(minFloat)
  const sec = Math.round(secFloat * 1000)

  return [[deg, 1], [min, 1], [sec, 1000]]
}
