// WARNING - code needs some cleanup

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const geolib = require('geolib');
const parser = require('subtitles-parser');
const piexif = require('piexifjs');
const parseArgs = require('minimist');

const argv = parseArgs(process.argv.slice(2));

const input = argv.i || argv.input;
const distance = argv.d || argv.distance || 5;
const outDir = argv.o || argv.outputDirectory || '.';

if (!input) {
  console.error('Usage: -i /path/to/video [-d distance] [-o output_directory]');
  process.exit(1);
}

const chunks = [];
const srtWriter = new stream.Writable();
srtWriter._write = function (chunk, encoding, done) {
  chunks.push(chunk.toString());
  done();
};

srtWriter.on('finish', function () {
  let frame = 0;
  let lat, lon, time, tt;

  let dist = 0;
  let dist0 = 0;

  const selectFilter = [];
  const positions = [];

  parser.fromSrt(chunks.join('')).forEach(item => {
    const m = /\}A,(\d+),(\d+\.\d+),([+-]?\d\d)(\d+\.\d+),(N),([+-]?\d\d\d)(\d+\.\d+),(E),([+-]?\d+.\d+),([+-]?\d+\.\d+),([+-]?\d+\.\d+),([+-]?\d+\.\d+);/.exec(item.text);
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
            selectFilter.push(frame ? `+lt(prev_selected_t\\,${ttR.toFixed(2)})`
              : `isnan(prev_selected_t)`, `*gt(t\\,${ttR.toFixed(2)})`);
            positions.push({ lat: latR, lon: lonR, time: timeR });
            frame++;
          }

          dist0 += distance;
        }

        tt = tt1;
      }

      [ lat, lon, time ] = [ lat1, lon1, time1 ];
    } else {
      console.error(`No GPS data found: ${item.text}`);
    }
  });

  ffmpeg()
    .input(input)
    .complexFilter({
      filter: 'select',
      options: selectFilter.join('')
    })
    .output(path.join(outDir, 'tmp%04d.jpg'))
    .outputOptions('-y', '-vsync', 'vfr', '-vframes', frame)
    // .on('start', function (commandLine) {
    //   console.log('Spawned Ffmpeg with command: ' + commandLine);
    // })
    .on('end', function () {
      for (let i = 0; i < frame; i++) {
        const tmpFilename = path.join(outDir, `tmp${('0000' + (i + 1)).slice(-4)}.jpg`);
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
        exifObj['GPS'][piexif.GPSIFD.GPSTimeStamp] = [
          [ date.getUTCHours(), 1 ],
          [ date.getUTCMinutes(), 1 ],
          [ Math.round(date.getUTCSeconds() * 1000 + date.getUTCMilliseconds()), 1000 ]
        ];

        const exifDate = `${date.getUTCFullYear()}:${_00(date.getUTCMonth() + 1)}:${_00(date.getUTCDate())}`;
        exifObj['GPS'][piexif.GPSIFD.GPSDateStamp] = exifDate;

        exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = `${exifDate} ${_00(date.getUTCHours())}:${_00(date.getUTCMinutes())}:${_00(date.getUTCSeconds())}`;
        exifObj['Exif'][piexif.ExifIFD.SubSecTimeOriginal] = date.getUTCMilliseconds().toString();

        const bearing1 = i > 0 ? geolib.getRhumbLineBearing(
          { latitude: positions[i - 1].lat, longitude: positions[i - 1].lon },
          { latitude: lat, longitude: lon }
        ) : null;

        const bearing2 = i < frame - 1 ? geolib.getRhumbLineBearing(
          { latitude: lat, longitude: lon },
          { latitude: positions[i + 1].lat, longitude: positions[i + 1].lon }
        ) : null;

        if (bearing1 !== null || bearing2 !== null) {
          const bearing = bearing1 === null ? bearing2 : bearing2 === null ? bearing1 : Math.atan2((Math.sin(bearing1 / 180 * Math.PI) + Math.sin(bearing2 / 180 * Math.PI)),
            (Math.cos(bearing1 / 180 * Math.PI) + Math.cos(bearing2 / 180 * Math.PI))) / Math.PI * 180;

          exifObj['GPS'][piexif.GPSIFD.GPSImgDirectionRef] = 'T';
          exifObj['GPS'][piexif.GPSIFD.GPSImgDirection] = [ [ Math.round(((bearing + 360) % 360) * 100), 100] ];
        }

        const newData = piexif.insert(piexif.dump(exifObj), data);
        const newJpeg = new Buffer(newData, 'binary');
        fs.writeFileSync(path.join(outDir, `img${('0000' + (i + 1)).slice(-4)}.jpg`), newJpeg);
        fs.unlinkSync(tmpFilename);
      }
    })
    .run();
});

ffmpeg()
  .input(input)
  .output(srtWriter)
  .format('srt')
  .run();

function degToDmsRational(degFloat) {
  const minFloat = degFloat % 1 * 60
  const secFloat = minFloat % 1 * 60
  const deg = Math.floor(degFloat)
  const min = Math.floor(minFloat)
  const sec = Math.round(secFloat * 1000)

  return [[deg, 1], [min, 1], [sec, 1000]]
}

function _00(n) {
  return ('0' + n).slice(-2);
}
