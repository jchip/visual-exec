"use strict";

/* eslint-disable no-magic-numbers,no-eval,prefer-template */

const xsh = require("xsh");
const Promise = require("bluebird");
const chalk = require("chalk");
const getDefaultLogger = require("./get-default-logger");
const VisualLogger = require("visual-logger");
const hasAnsi = require("has-ansi");
const stripAnsi = require("strip-ansi");

xsh.Promise = Promise;

const ONE_MB = 1024 * 1024;

class VisualExec {
  constructor({
    command,
    cwd = process.cwd(),
    visualLogger,
    spinner = VisualLogger.spinners[1],
    displayTitle = undefined,
    logLabel = undefined,
    outputLabel = undefined,
    outputLevel = "verbose",
    maxBuffer = 5 * ONE_MB
  }) {
    this._title = displayTitle || this._makeTitle(command);
    this._logLabel = logLabel || this._title;
    this._outputLabel = outputLabel || this._title;
    this._command = command;
    this._cwd = cwd || process.cwd();
    this._logger = visualLogger || getDefaultLogger();
    this._outputLevel = outputLevel;
    this._spinner = spinner;
    this._maxBuffer = maxBuffer;
  }

  _makeTitle(command) {
    if (typeof command !== "string") {
      command = "user command";
    }

    return `Running ${command}`;
  }

  /* eslint-disable max-statements */
  _updateDigest(item, buf) {
    if (item.buf.indexOf("\n") >= 0 || buf.indexOf("\n") >= 0) {
      item.buf = buf;
    } else {
      item.buf += buf;
    }
    buf = item.buf;
    buf = buf && buf.trim();
    if (buf) {
      if (hasAnsi(buf)) buf = stripAnsi(buf);
      this._logger.updateItem(item.name, {
        msg: buf
          .split("\n")
          .map(x => x && x.trim())
          .filter(x => x)
          .join("\\n")
          .substr(0, 100)
          .replace(/\\n/g, chalk.blue("\\n")),
        _save: false,
        _render: false
      });
    }
  }

  show(child) {
    this._stdoutKey = Symbol("visual-exec-stdout");
    this._stderrKey = Symbol("visual-exec-stderr");

    this._logger.addItem({
      name: this._stdoutKey,
      color: "green",
      display: `=== ${this._title}\nstdout`,
      spinner: this._spinner
    });

    this._logger.addItem({
      name: this._stderrKey,
      color: "red",
      display: `stderr`
    });

    const stdoutDigest = { name: this._stdoutKey, buf: "" };
    const stderrDigest = { name: this._stderrKey, buf: "" };
    this._updateStdout = buf => this._updateDigest(stdoutDigest, buf);
    this._updateStderr = buf => this._updateDigest(stderrDigest, buf);

    child.stdout.on("data", this._updateStdout);
    child.stderr.on("data", this._updateStderr);

    this._child = child;

    return child.promise
      .catch(err => {
        this.logResult(err);
        throw err;
      })
      .tap(output => this.logResult(null, output));
  }

  logResult(err, output) {
    const child = this._child;

    this._logger.removeItem(this._stdoutKey);
    this._logger.removeItem(this._stderrKey);
    child.stdout.removeListener("data", this._updateStdout);
    child.stderr.removeListener("data", this._updateStderr);

    const result = err ? `failed ${chalk.red(err.message)}` : chalk.green("exit code 0");

    const level = err ? "error" : "info";

    if (err) {
      output = err.output;
    }

    this._logger[level](`Done ${this._logLabel} ${result}`);

    this.logFinalOutput(err, output);
  }

  logFinalOutput(err, output) {
    const level = err ? "error" : this._outputLevel;

    if (!output || (!output.stdout && !output.stderr)) {
      this._logger[level](`${chalk.green("No output")} from ${this._outputLabel}`);
      return;
    }

    const colorize = t => t.replace(/ERR!/g, chalk.red("ERR!"));

    const logs = [chalk.green(">>>")];
    logs.push(`Start of output from ${this._outputLabel} ===`);

    if (output.stdout) {
      logs.push(`\n${colorize(output.stdout)}`);
    }

    if (output.stderr) {
      logs.push(chalk.red("\n=== stderr ===\n") + colorize(output.stderr));
    }

    logs.push(chalk.blue("\n<<<"));
    logs.push(`End of output from ${this._outputLabel} ---`);

    this._logger.prefix(false)[level](...logs);
  }

  execute(command) {
    const child = xsh.exec(
      {
        silent: true,
        cwd: this._cwd,
        env: Object.assign({}, process.env, { PWD: this._cwd }),
        maxBuffer: this._maxBuffer
      },
      command || this._command
    );

    return this.show(child);
  }
}

module.exports = VisualExec;
