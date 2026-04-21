import {
  changePassword,
  createAccount,
  deleteAccount,
  getAccountDetails,
  getProfile,
  listAccounts,
  loginWithCredentials,
  loginWithGoogle,
  lockAccount,
  requestForgotPasswordCode,
  requestSignupVerificationCode,
  signupWithGoogle,
  updateAccount,
  updateProfile,
  updateProfileAvatar,
  unlockAccount,
  verifyForgotPasswordCode,
  verifySignupVerificationCode,
} from '../services/auth.service.js';

function sendKnownAuthError(response, error) {
  if (!error?.statusCode) {
    return false;
  }

  response.status(error.statusCode).json({
    success: false,
    message: error.message,
    ...(error.details ?? {}),
  });

  return true;
}

export async function credentialLoginController(request, response, next) {
  try {
    const result = await loginWithCredentials(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function requestSignupVerificationCodeController(request, response, next) {
  try {
    const result = await requestSignupVerificationCode(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function verifySignupVerificationCodeController(request, response, next) {
  try {
    const result = await verifySignupVerificationCode(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function requestForgotPasswordCodeController(request, response, next) {
  try {
    const result = await requestForgotPasswordCode(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function verifyForgotPasswordCodeController(request, response, next) {
  try {
    const result = await verifyForgotPasswordCode(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function changePasswordController(request, response, next) {
  try {
    const result = await changePassword(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getProfileController(request, response, next) {
  try {
    const result = await getProfile(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function listAccountsController(request, response, next) {
  try {
    const result = await listAccounts();
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function getAccountDetailsController(request, response, next) {
  try {
    const result = await getAccountDetails(request.params.accountId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function createAccountController(request, response, next) {
  try {
    const result = await createAccount(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updateAccountController(request, response, next) {
  try {
    const result = await updateAccount(request.params.accountId, request.body, request.file);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function deleteAccountController(request, response, next) {
  try {
    const result = await deleteAccount(request.params.accountId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function lockAccountController(request, response, next) {
  try {
    const result = await lockAccount(request.params.accountId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function unlockAccountController(request, response, next) {
  try {
    const result = await unlockAccount(request.params.accountId);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updateProfileController(request, response, next) {
  try {
    const result = await updateProfile(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function updateProfileAvatarController(request, response, next) {
  try {
    const result = await updateProfileAvatar(request.body, request.file);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function googleLoginController(request, response, next) {
  try {
    const result = await loginWithGoogle(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function googleSignupController(request, response, next) {
  try {
    const result = await signupWithGoogle(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAuthError(response, error)) {
      return;
    }

    next(error);
  }
}
