import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            background: '#09090b',
            color: '#fafafa',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>页面出错了</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#18181b',
              padding: 16,
              borderRadius: 12,
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null })
              window.location.href = '/'
            }}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#0284c7',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            返回首页
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
