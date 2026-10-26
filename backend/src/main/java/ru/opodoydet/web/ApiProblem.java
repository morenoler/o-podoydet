package ru.opodoydet.web;

public final class ApiProblem extends RuntimeException {
  private final int status;

  public ApiProblem(int status, String message) {
    super(message);
    this.status = status;
  }

  public int status() {
    return status;
  }
}
