import type { ResponseCaptureRule } from '../types'

const createCaptureRule = (): ResponseCaptureRule => ({
  id: crypto.randomUUID(),
  enabled: true,
  jsonPath: '',
  variableName: '',
})

type ResponseCaptureEditorProps = {
  rules: ResponseCaptureRule[]
  variableOptions: string[]
  disabled?: boolean
  onRulesChange: (rules: ResponseCaptureRule[]) => void
  feedback: string | null
}

export function ResponseCaptureEditor({
  rules,
  variableOptions,
  disabled = false,
  onRulesChange,
  feedback,
}: ResponseCaptureEditorProps) {
  const sortedOptions = [...variableOptions].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )

  const updateRule = (
    ruleId: string,
    patch: Partial<ResponseCaptureRule>,
  ) => {
    onRulesChange(
      rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      ),
    )
  }

  const removeRule = (ruleId: string) => {
    onRulesChange(rules.filter((rule) => rule.id !== ruleId))
  }

  const addRule = () => {
    onRulesChange([...rules, createCaptureRule()])
  }

  return (
    <div className="response-capture-editor">
      <div className="response-capture-editor__header">
        <div>
          <h3 className="response-capture-editor__title">Salvar em variável</h3>
          <p className="subtle response-capture-editor__hint">
            A cada envio bem-sucedido (resposta com body JSON), os valores são lidos de
            novo e as variáveis do ambiente ativo são atualizadas (sobrescritas).
          </p>
        </div>
        <div className="response-capture-editor__actions">
          <button
            className="primary-button primary-button--compact"
            type="button"
            disabled={disabled}
            onClick={addRule}
          >
            + Regra
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="subtle response-capture-editor__empty">
          Adicione uma regra para mapear um campo do JSON e salvar em uma variável{' '}
          <code>{'{{nomeDaVariavel}}'}</code> no ambiente.
        </p>
      ) : (
        <ul className="response-capture-editor__list">
          {rules.map((rule) => (
            <li className="response-capture-editor__row" key={rule.id}>
              <label className="response-capture-editor__check">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={disabled}
                  onChange={(event) =>
                    updateRule(rule.id, { enabled: event.target.checked })
                  }
                  aria-label="Ativar esta regra"
                />
              </label>
              <label className="response-capture-editor__field">
                <span className="subtle">Caminho no JSON</span>
                <input
                  type="text"
                  placeholder="ex: access_token"
                  value={rule.jsonPath}
                  disabled={disabled}
                  onChange={(event) =>
                    updateRule(rule.id, { jsonPath: event.target.value })
                  }
                />
              </label>
              <label className="response-capture-editor__field">
                <span className="subtle">Nome da variável</span>
                <input
                  type="text"
                  placeholder="ex: authToken"
                  value={rule.variableName}
                  disabled={disabled}
                  onChange={(event) =>
                    updateRule(rule.id, { variableName: event.target.value })
                  }
                  list="response-capture-variable-names"
                />
              </label>
              <button
                className="danger-button danger-button--compact"
                type="button"
                disabled={disabled}
                onClick={() => removeRule(rule.id)}
                aria-label="Remover regra"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <datalist id="response-capture-variable-names">
        {sortedOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {feedback ? (
        <p className="response-capture-editor__feedback" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  )
}
