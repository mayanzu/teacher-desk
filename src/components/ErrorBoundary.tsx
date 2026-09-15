import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('课表渲染出错', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal-error" role="alert">
        <h1>页面出现异常</h1>
        <p>{this.state.error.message || '未知错误'}</p>
        <div className="fatal-error-actions">
          <button type="button" className="kbtn primary" onClick={() => this.setState({ error: null })}>重试</button>
          <button type="button" className="kbtn ghost" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    );
  }
}
