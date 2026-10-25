package ru.opodoydet.accounts.photos;

import static org.junit.jupiter.api.Assertions.*;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class ImageSanitizerTest {
  private static final Color[] COLORS = {Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW};
  private static final String PRIVATE = "EXIF_GPS_PRIVATE_METADATA";

  private static byte[] jpeg(int width, int height) throws Exception {
    var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
    var graphics = image.createGraphics();
    for (int i = 0; i < 4; i++) {
      graphics.setColor(COLORS[i]);
      graphics.fillRect(i % 2 * width / 2, i / 2 * height / 2, width / 2, height / 2);
    }
    graphics.dispose();
    var output = new ByteArrayOutputStream();
    assertTrue(ImageIO.write(image, "jpg", output));
    image.flush();
    return output.toByteArray();
  }

  private static byte[] tiff(int orientation, ByteOrder order) {
    return ByteBuffer.allocate(26)
        .order(order)
        .put(order == ByteOrder.LITTLE_ENDIAN ? (byte) 'I' : (byte) 'M')
        .put(order == ByteOrder.LITTLE_ENDIAN ? (byte) 'I' : (byte) 'M')
        .putShort((short) 42)
        .putInt(8)
        .putShort((short) 1)
        .putShort((short) 0x0112)
        .putShort((short) 3)
        .putInt(1)
        .putShort((short) orientation)
        .putShort((short) 0)
        .putInt(0)
        .array();
  }

  private static byte[] withExif(byte[] jpeg, byte[] tiff) throws Exception {
    var payload = new ByteArrayOutputStream();
    payload.write(new byte[] {'E', 'x', 'i', 'f', 0, 0});
    payload.write(tiff);
    payload.write(PRIVATE.getBytes(StandardCharsets.US_ASCII));
    var output = new ByteArrayOutputStream();
    output.write(jpeg, 0, 2);
    output.write(new byte[] {(byte) 0xff, (byte) 0xe1});
    int size = payload.size() + 2;
    output.write(size >> 8);
    output.write(size & 0xff);
    payload.writeTo(output);
    output.write(jpeg, 2, jpeg.length - 2);
    return output.toByteArray();
  }

  @Test
  void allEightExifOrientationsUsePixelsAndStripMetadataInBothByteOrders() throws Exception {
    int[][] expected = {
      {0, 1, 2, 3}, {1, 0, 3, 2}, {3, 2, 1, 0}, {2, 3, 0, 1}, {0, 2, 1, 3}, {2, 0, 3, 1},
      {3, 1, 2, 0}, {1, 3, 0, 2}
    };
    byte[] source = jpeg(100, 60);
    for (ByteOrder order : new ByteOrder[] {ByteOrder.LITTLE_ENDIAN, ByteOrder.BIG_ENDIAN}) {
      for (int orientation = 1; orientation <= 8; orientation++) {
        var clean =
            ImageSanitizer.sanitize(withExif(source, tiff(orientation, order)), "image/jpeg");
        assertEquals(orientation >= 5 ? 60 : 100, clean.width());
        assertEquals(orientation >= 5 ? 100 : 60, clean.height());
        var decoded = ImageIO.read(new ByteArrayInputStream(clean.bytes()));
        assertQuadrants(decoded, expected[orientation - 1]);
        assertFalse(new String(clean.bytes(), StandardCharsets.ISO_8859_1).contains(PRIVATE));
        assertFalse(new String(clean.bytes(), StandardCharsets.ISO_8859_1).contains("Exif\0\0"));
        assertEquals(1, ExifOrientation.read(clean.bytes()));
      }
    }
  }

  @Test
  void orientationIsAppliedBeforeResizeAndMalformedMetadataIsIgnored() throws Exception {
    var portrait =
        ImageSanitizer.sanitize(
            withExif(jpeg(3000, 1000), tiff(6, ByteOrder.LITTLE_ENDIAN)), "image/jpeg");
    assertEquals(800, portrait.width());
    assertEquals(2400, portrait.height());
    assertQuadrants(
        ImageIO.read(new ByteArrayInputStream(portrait.bytes())), new int[] {2, 0, 3, 1});

    byte[] source = jpeg(100, 60);
    for (int position : new int[] {0, 2, 4, 8, 12, 14, 18}) {
      byte[] broken = tiff(6, ByteOrder.LITTLE_ENDIAN);
      broken[position] = (byte) 0xff;
      var clean = ImageSanitizer.sanitize(withExif(source, broken), "image/jpeg");
      assertEquals(100, clean.width(), "Malformed TIFF byte " + position);
      assertEquals(60, clean.height());
      assertQuadrants(
          ImageIO.read(new ByteArrayInputStream(clean.bytes())), new int[] {0, 1, 2, 3});
    }
    // Truncation and unsigned 32-bit offsets cannot cause out-of-bounds reads or allocation.
    for (int length = 0; length < 26; length++) {
      byte[] truncated = Arrays.copyOf(tiff(6, ByteOrder.LITTLE_ENDIAN), length);
      assertDoesNotThrow(() -> ExifOrientation.read(withExif(source, truncated)));
    }
    byte[] offset = tiff(6, ByteOrder.BIG_ENDIAN);
    ByteBuffer.wrap(offset).putInt(4, -1);
    assertEquals(1, ExifOrientation.read(withExif(source, offset)));
  }

  private static void assertQuadrants(BufferedImage image, int[] expected) {
    for (int i = 0; i < 4; i++) {
      Color actual =
          new Color(
              image.getRGB(
                  (i % 2 * 2 + 1) * image.getWidth() / 4, (i / 2 * 2 + 1) * image.getHeight() / 4));
      Color target = COLORS[expected[i]];
      assertTrue(
          Math.abs(actual.getRed() - target.getRed()) < 30
              && Math.abs(actual.getGreen() - target.getGreen()) < 30
              && Math.abs(actual.getBlue() - target.getBlue()) < 30,
          "Unexpected quadrant " + i + ": " + actual);
    }
  }
}
