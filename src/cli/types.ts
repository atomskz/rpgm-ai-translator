export type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export type CommandHandler = (args: string[], io: CliIO) => Promise<number>;
