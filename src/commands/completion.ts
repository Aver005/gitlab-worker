import { CliError } from '../errors.ts';

import type { Command } from '../cli/command.ts';

const bash = (words: string) => `# glw bash completion
# Add to ~/.bashrc:  eval "$(glw completion bash)"
_glw_complete() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${words}" -- "\${cur}") )
  elif [[ "\${prev}" == "use" || "\${prev}" == "--project" ]]; then
    local projects
    projects=$(glw __complete projects 2>/dev/null)
    COMPREPLY=( $(compgen -W "\${projects}" -- "\${cur}") )
  fi
}
complete -F _glw_complete glw`;

const zsh = (words: string) => `# glw zsh completion
# Add to ~/.zshrc:  eval "$(glw completion zsh)"
_glw() {
  local state
  _arguments \\
    '1: :->cmd' \\
    '*: :->args'
  case $state in
    cmd)
      compadd ${words}
      ;;
    args)
      case \${words[2]} in
        use|--project)
          local projects
          projects=(\${(f)"$(glw __complete projects 2>/dev/null)"})
          compadd $projects
          ;;
      esac
      ;;
  esac
}
compdef _glw glw`;

const powershell = (words: string) => `# glw PowerShell completion
# Add to $PROFILE:  glw completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName glw -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = $commandAst.CommandElements
  $prev = if ($words.Count -ge 2) { $words[$words.Count - 2].ToString() } else { '' }
  if ($words.Count -le 2) {
    '${words}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
  } elseif ($prev -eq 'use' -or $prev -eq '--project') {
    $projects = (glw __complete projects 2>$null) -split '\`n'
    $projects | Where-Object { $_ -like "$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
  }
}`;

const SCRIPTS: Record<string, (words: string) => string> = {
    bash,
    zsh,
    powershell,
};

const help = () => `
glw completion <bash|zsh|powershell>

Print a shell completion script. Setup:
  bash:        eval "$(glw completion bash)"        # in ~/.bashrc
  zsh:         eval "$(glw completion zsh)"         # in ~/.zshrc
  powershell:  glw completion powershell | Out-String | Invoke-Expression  # in $PROFILE

Completes command names and project paths after "use" / "--project"
(from the project cache, updated by "glw projects").
`;

/** Имена команд приходят из реестра, чтобы список не расходился с диспетчером. */
export function completionCommand(commandWords: () => string[]): Command {
    return {
        name: 'completion',
        synopsis: 'completion <shell>',
        summary: 'Print shell completion script (bash|zsh|powershell)',
        help,
        async run(args) {
            const shell = args[0];
            if (!shell) {
                console.log(help());
                return;
            }
            const script = SCRIPTS[shell];
            if (!script) {
                throw new CliError(
                    `Unknown shell: "${shell}". Use: bash, zsh, or powershell`,
                );
            }
            console.log(script(commandWords().join(' ')));
        },
    };
}
