package ru.opodoydet.accounts.photos;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import ru.opodoydet.accounts.AccountProblem;

/** Decode pixels, then write a new image without any source metadata or trailing data. */
final class ImageSanitizer {
  record Image(byte[] bytes, String extension, String mime, int width, int height) {}

  private ImageSanitizer() {}

  static Image sanitize(byte[] source, String mime) {
    try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(source))) {
      var readers = ImageIO.getImageReaders(input);
      if (!readers.hasNext()) throw invalid();
      ImageReader reader = readers.next();
      try {
        String format = reader.getFormatName().toLowerCase(Locale.ROOT);
        String actual =
            format.equals("jpeg") || format.equals("jpg")
                ? "image/jpeg"
                : format.equals("png") ? "image/png" : "";
        if (!actual.equals(mime))
          throw new AccountProblem(
              415, "Содержимое файла не соответствует JPEG или PNG выбранного типа.");
        reader.setInput(input, true, true);
        int width = reader.getWidth(0), height = reader.getHeight(0);
        if (width < 1
            || height < 1
            || width > 12000
            || height > 12000
            || (long) width * height > 20_000_000)
          throw new AccountProblem(
              400,
              "Фото должно содержать не более 20 млн пикселей и не более 12 000 пикселей по"
                  + " стороне.");
        BufferedImage decoded = reader.read(0);
        boolean jpeg = mime.equals("image/jpeg");
        int orientation = jpeg ? ExifOrientation.read(source) : 1;
        int orientedWidth = orientation >= 5 ? height : width;
        int orientedHeight = orientation >= 5 ? width : height;
        double scale = Math.min(1.0, 2400.0 / Math.max(orientedWidth, orientedHeight));
        int outputWidth = Math.max(1, (int) Math.round(orientedWidth * scale));
        int outputHeight = Math.max(1, (int) Math.round(orientedHeight * scale));
        BufferedImage clean =
            new BufferedImage(
                outputWidth,
                outputHeight,
                jpeg ? BufferedImage.TYPE_INT_RGB : BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = clean.createGraphics();
        try {
          graphics.setRenderingHint(
              RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
          graphics.scale(
              (double) outputWidth / orientedWidth, (double) outputHeight / orientedHeight);
          graphics.drawImage(decoded, ExifOrientation.transform(orientation, width, height), null);
        } finally {
          graphics.dispose();
          decoded.flush();
        }
        String extension = jpeg ? "jpg" : "png";
        try (var bytes = new ByteArrayOutputStream();
            var output = new MemoryCacheImageOutputStream(bytes)) {
          if (!ImageIO.write(clean, extension, output)) throw invalid();
          output.flush();
          return new Image(bytes.toByteArray(), extension, mime, outputWidth, outputHeight);
        } finally {
          clean.flush();
        }
      } finally {
        reader.dispose();
      }
    } catch (IOException | IllegalArgumentException e) {
      throw invalid();
    }
  }

  private static AccountProblem invalid() {
    return new AccountProblem(
        400, "Не удалось прочитать фотографию. Выберите исправный JPEG или PNG.");
  }
}
