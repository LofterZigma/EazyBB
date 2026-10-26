import { BlackboardAuthError } from './blackboard.js';

export function createBlackboardSessionManager({ getCredentials, loginWithCredentials, refreshSession }) {
  let loginPromise = null;

  function relogin() {
    if (!loginPromise) {
      loginPromise = (async () => {
        const saved = await getCredentials();
        if (saved?.studentId && saved?.password) {
          const result = await loginWithCredentials(saved.studentId, saved.password);
          if (!result.valid) throw new Error('已保存的学号或密码不正确，请在设置中修改');
          return;
        }
        if (await refreshSession().catch(() => false)) return;
        throw new Error('Blackboard 登录已失效，请先在设置中填写并保存校园账号');
      })().finally(() => { loginPromise = null; });
    }
    return loginPromise;
  }

  async function run(task) {
    try {
      return await task();
    } catch (error) {
      if (!(error instanceof BlackboardAuthError)) throw error;
      await relogin();
      try {
        return await task();
      } catch (retryError) {
        if (retryError instanceof BlackboardAuthError) {
          throw new Error('Blackboard 重新登录后仍无法读取数据，请稍后重试');
        }
        throw retryError;
      }
    }
  }

  return { relogin, run };
}
