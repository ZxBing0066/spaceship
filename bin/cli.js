import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'node:path';
import fs from 'node:fs';
import child_process from 'node:child_process';
import ora from 'ora';
import boxen from 'boxen';
import console from 'console';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

const inquirer = require('inquirer');
const table = require('inquirer-table-prompt');
const chalk = require('chalk');

inquirer.registerPrompt('table', table);

const list = ['typescript', 'commitizen', 'husky', 'lint-staged', 'editorconfig', 'prettier', 'eslint'];

const lError = msg => console.error(chalk.redBright(msg));
const lSuccess = msg => console.error(chalk.greenBright(msg));
const lLog = msg => console.error(chalk.blueBright(msg));
const lUnimportant = msg => console.error(chalk.gray(msg));

inquirer
    .prompt([
        {
            type: 'table',
            name: 'tools',
            message: '选择需要安装的工具（所有的工具只会安装在项目目录）',
            columns: [
                {
                    name: 'Wanted',
                    value: undefined
                },
                {
                    name: 'Unwanted',
                    value: true
                }
            ],
            rows: list.map((name, i) => ({ name, value: i }))
        },
        {
            type: 'list',
            name: 'pm',
            message: '请选择需要使用的包管理器',
            choices: ['pnpm', 'yarn', 'npm']
        }
    ])
    .then(answers => {
        const toolMap = {};
        list.forEach((v, i) => {
            toolMap[v] = !answers.tools[i];
        });

        jobs(toolMap, answers.pm);
    });

const getPackages = toolMap => {
    const packages = [];
    list.forEach(name => {
        if (name === 'editorconfig') return;
        if (toolMap[name]) packages.push(name);
    });
    const { commitizen, typescript, eslint, prettier } = toolMap;
    if (commitizen) packages.push('git-cz');
    if (typescript && eslint) {
        packages.push('@typescript-eslint/eslint-plugin', '@typescript-eslint/parser');
    }
    if (prettier && eslint) {
        packages.push('eslint-config-prettier');
    }
    return packages;
};

const isPnpmWorkspace = () => {
    return fs.existsSync(path.resolve(cwd, 'pnpm-workspace.yaml'));
};

const installPackages = async (packages, pm) => {
    if (!packages.length) lUnimportant('No packages need to install');
    const command = (() => {
        const packagesString = packages.join(' ');
        switch (pm) {
            case 'pnpm': {
                const inWorkspace = isPnpmWorkspace();
                return `pnpm add ${packagesString} -D` + (inWorkspace ? ' -w' : '');
            }
            case 'npm':
                return `npm add ${packagesString} -D`;
            case 'yarn':
                return `yarn add ${packagesString} -D`;
            default:
                throw `unknown package manager: ${pm}`;
        }
    })();
    lLog(`Install packages with ${pm}: ${packages.join(' ')}`);

    return new Promise((resolve, reject) => {
        const spinner = ora('Installing').start();
        child_process.exec(command, (error, stdout, stderr) => {
            if (error || stderr) {
                reject(error || stderr);
            }
            spinner.succeed('Packages installed');
            lLog(boxen(stdout, { padding: 1 }));
            resolve();
        });
    });
};

const jobs = async (toolMap, pm) => {
    const packages = getPackages(toolMap);
    await installPackages(packages, pm);
    for (const toolName of list) {
        if (jobMap[toolName]) {
            await jobMap[toolName](toolName, toolMap[toolName], toolMap, pm);
        }
    }
};

const configBasePath = path.resolve(__dirname, './config/');
const cwd = process.cwd();

const checkFile = file => {
    const fullFilePath = path.resolve(cwd, file);
    if (fs.existsSync(fullFilePath)) {
        return `File existed at: ${fullFilePath}`;
    }
};

const jobWrapper = job => async (name, wanted, tools, pm) => {
    if (!wanted) {
        lUnimportant(`Skip ${name}`);
        return;
    }
    try {
        await job(name, tools, pm);
        lSuccess(`${name} job success.`);
    } catch (error) {
        lError(error);
        lError(`${name} job fail`);
    }
};

const copyJob = files => {
    if (!Array.isArray(files)) {
        files = [files];
    }
    files.forEach(file => {
        const fileCheckResult = checkFile(file);
        if (fileCheckResult) {
            lError(fileCheckResult);
        } else {
            fs.copyFileSync(path.resolve(configBasePath, file), path.resolve(cwd, file));
        }
    });
};

const jobMap = {
    commitizen: jobWrapper(() => {
        copyJob(['.czrc', '.git-cz.json']);
    }),
    husky: jobWrapper((name, tools) => {
        child_process.execSync('npm set-script prepare "husky install"');
        child_process.execSync('npm run prepare');
        if (tools['lint-staged']) {
            child_process.execSync('npx husky add .husky/pre-commit "npx lint-staged"');
        } else {
            child_process.execSync('npx husky add .husky/pre-commit "npm test"');
        }
    }),
    'lint-staged': jobWrapper(() => {
        copyJob('.lintstagedrc');
    }),
    editorconfig: jobWrapper(() => {
        copyJob('.editorconfig');
    }),
    prettier: jobWrapper(() => {
        copyJob('.prettierrc');
    }),
    eslint: jobWrapper(() => {
        copyJob('.eslintrc');
    })
};
