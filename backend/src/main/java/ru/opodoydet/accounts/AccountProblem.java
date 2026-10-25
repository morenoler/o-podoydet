package ru.opodoydet.accounts;

public final class AccountProblem extends RuntimeException {
  public final int status;

  public AccountProblem(int status, String message) {
    super(message);
    this.status = status;
  }
}
