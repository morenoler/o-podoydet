package ru.opodoydet.accounts.web;

import java.io.IOException;
import java.sql.SQLException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.accounts.questions.QuestionService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.application.SearchExtension;
import ru.opodoydet.config.AppSettings;
import ru.opodoydet.persistence.Store;

/** Spring owns account services and closes their SQLite connection on shutdown. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "ACCOUNT_MODE", havingValue = "true", matchIfMissing = true)
public class AccountConfiguration {
  @Bean(destroyMethod = "close")
  AccountDatabase accountDatabase(Store store) throws SQLException, IOException {
    return new AccountDatabase(store.databasePath());
  }

  @Bean
  AuthService authService(AccountDatabase database) {
    return new AuthService(database);
  }

  @Bean
  ListingService listingService(AccountDatabase database) {
    return new ListingService(database);
  }

  @Bean
  BookingService bookingService(AccountDatabase database, ListingService listings) {
    return new BookingService(database, listings);
  }

  @Bean
  QuestionService questionService(AccountDatabase database, ListingService listings) {
    return new QuestionService(database, listings);
  }

  @Bean
  PhotoService photoService(AccountDatabase database, AppSettings settings) {
    return new PhotoService(database, settings.path("UPLOADS_PATH", ".local/uploads"));
  }

  @Bean
  SearchExtension ownerListingSearchProvider(AccountDatabase database) {
    return new OwnerListingSearchProvider(database);
  }
}
