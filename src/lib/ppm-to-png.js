import { deflateSync, crc32 } from 'node:zlib';

// Парсит бинарный PPM (формат P6, тот, что пишет QMP screendump) в
// { width, height, pixels } — pixels это плотный RGB-буфер.
function parsePpm(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x36) { // "P6"
    throw new Error('ожидался PPM формата P6');
  }
  let offset = 2;
  const tokens = [];
  while (tokens.length < 3) {
    while (buffer[offset] === 0x20 || buffer[offset] === 0x0a || buffer[offset] === 0x09) offset++;
    if (buffer[offset] === 0x23) { // '#' комментарий до конца строки
      while (buffer[offset] !== 0x0a) offset++;
      continue;
    }
    let token = '';
    while (buffer[offset] > 0x20) { token += String.fromCharCode(buffer[offset]); offset++; }
    tokens.push(Number(token));
  }
  offset++; // единственный пробельный символ сразу после maxval
  const [width, height] = tokens;
  return { width, height, pixels: buffer.subarray(offset, offset + width * height * 3) };
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

// Кодирует несжатый RGB-кадр в валидный PNG (8 бит/канал, без палитры,
// filter=None построчно). Ровно то, что нужно для скриншотов VM — без
// внешних зависимостей (imagemagick/pillow в окружении нет и не нужен).
export function ppmToPng(ppmBuffer) {
  const { width, height, pixels } = parsePpm(ppmBuffer);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(2, 9);   // color type: RGB
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
