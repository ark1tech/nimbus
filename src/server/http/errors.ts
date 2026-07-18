export class HttpProblem extends Error {
  public readonly statusCode: number;
  public readonly details: string;

  public constructor(statusCode: number, message: string, details: string) {
    super(message);
    this.name = "HttpProblem";
    this.statusCode = statusCode;
    this.details = details;
  }
}
