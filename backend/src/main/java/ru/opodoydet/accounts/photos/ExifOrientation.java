package ru.opodoydet.accounts.photos;

import java.awt.geom.AffineTransform;

/** Only IFD0's inline SHORT Orientation is read. No recursive offsets or metadata allocation. */
final class ExifOrientation {
  private ExifOrientation() {}

  static int read(byte[] jpeg) {
    if (jpeg.length < 4 || unsigned(jpeg[0]) != 0xff || unsigned(jpeg[1]) != 0xd8) return 1;
    int position = 2;
    while (position < jpeg.length) {
      if (unsigned(jpeg[position++]) != 0xff) return 1;
      while (position < jpeg.length && unsigned(jpeg[position]) == 0xff) position++;
      if (position == jpeg.length) return 1;
      int marker = unsigned(jpeg[position++]);
      if (marker == 0xda || marker == 0xd9 || marker == 0) return 1;
      if (marker == 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (position > jpeg.length - 2) return 1;
      int size = shortAt(jpeg, position, false);
      if (size < 2 || size > jpeg.length - position) return 1;
      int payload = position + 2;
      if (marker == 0xe1
          && size >= 16
          && jpeg[payload] == 'E'
          && jpeg[payload + 1] == 'x'
          && jpeg[payload + 2] == 'i'
          && jpeg[payload + 3] == 'f'
          && jpeg[payload + 4] == 0
          && jpeg[payload + 5] == 0) {
        int orientation = tiff(jpeg, payload + 6, position + size);
        if (orientation >= 1 && orientation <= 8) return orientation;
      }
      position += size;
    }
    return 1;
  }

  private static int tiff(byte[] data, int start, int end) {
    if (end - start < 8) return 0;
    boolean little = data[start] == 'I' && data[start + 1] == 'I';
    if (!little && !(data[start] == 'M' && data[start + 1] == 'M')) return 0;
    if (shortAt(data, start + 2, little) != 42) return 0;
    long offset = intAt(data, start + 4, little);
    if (offset < 8 || offset > end - start - 2) return 0;
    int directory = start + (int) offset;
    int count = shortAt(data, directory, little);
    if (count > (end - directory - 2) / 12) return 0;
    for (int entry = directory + 2, i = 0; i < count; i++, entry += 12) {
      if (shortAt(data, entry, little) != 0x0112) continue;
      if (shortAt(data, entry + 2, little) != 3 || intAt(data, entry + 4, little) != 1) return 0;
      return shortAt(data, entry + 8, little);
    }
    return 0;
  }

  private static int unsigned(byte value) {
    return value & 0xff;
  }

  private static int shortAt(byte[] data, int offset, boolean little) {
    return little
        ? unsigned(data[offset]) | unsigned(data[offset + 1]) << 8
        : unsigned(data[offset]) << 8 | unsigned(data[offset + 1]);
  }

  private static long intAt(byte[] data, int offset, boolean little) {
    long first = shortAt(data, offset, little), second = shortAt(data, offset + 2, little);
    return little ? first | second << 16 : first << 16 | second;
  }

  static AffineTransform transform(int orientation, int width, int height) {
    return switch (orientation) {
      case 2 -> new AffineTransform(-1, 0, 0, 1, width, 0);
      case 3 -> new AffineTransform(-1, 0, 0, -1, width, height);
      case 4 -> new AffineTransform(1, 0, 0, -1, 0, height);
      case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0);
      case 6 -> new AffineTransform(0, 1, -1, 0, height, 0);
      case 7 -> new AffineTransform(0, -1, -1, 0, height, width);
      case 8 -> new AffineTransform(0, -1, 1, 0, 0, width);
      default -> new AffineTransform();
    };
  }
}
