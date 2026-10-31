import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"

import { installT3 } from "../src/contenders/t3code/install"
import { localMachine } from "./local-machine"

const workdir = process.env.KIKO_BENCH_WORKDIR ?? tmpdir()
const installed = await installT3(localMachine(workdir))
const outputFile = process.env.KIKO_BENCH_T3_BIN_FILE
if (outputFile !== undefined) await writeFile(outputFile, `${installed.bin}\n`)
process.stdout.write(`${JSON.stringify(installed)}\n`)
