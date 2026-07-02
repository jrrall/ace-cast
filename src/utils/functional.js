/**
 * Functional programming utilities to reduce imperative code patterns
 */

/**
 * Pipe function - compose functions from left to right
 * @param {...Function} fns - Functions to compose
 * @returns {Function} - Composed function
 */
const pipe = (...fns) => (value) => fns.reduce((acc, fn) => fn(acc), value);

/**
 * Compose function - compose functions from right to left
 * @param {...Function} fns - Functions to compose
 * @returns {Function} - Composed function
 */
const compose = (...fns) => (value) => fns.reduceRight((acc, fn) => fn(acc), value);

/**
 * Partial application helper
 * @param {Function} fn - Function to partially apply
 * @param {...*} args - Arguments to pre-apply
 * @returns {Function} - Partially applied function
 */
const partial = (fn, ...args) => (...remainingArgs) => fn(...args, ...remainingArgs);

/**
 * Curry a function
 * @param {Function} fn - Function to curry
 * @param {number} arity - Number of arguments expected (defaults to fn.length)
 * @returns {Function} - Curried function
 */
const curry = (fn, arity = fn.length) => {
  return function curried(...args) {
    if (args.length >= arity) {
      return fn.apply(this, args);
    }
    return function (...nextArgs) {
      return curried.apply(this, [...args, ...nextArgs]);
    };
  };
};

/**
 * Deep clone an object (immutable helper)
 * @param {*} obj - Object to clone
 * @returns {*} - Deep cloned object
 */
const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (obj instanceof Map) {
    const cloned = new Map();
    obj.forEach((value, key) => cloned.set(key, deepClone(value)));
    return cloned;
  }
  if (obj instanceof Set) {
    return new Set([...obj].map(item => deepClone(item)));
  }
  if (typeof obj === 'object') {
    const cloned = {};
    Object.keys(obj).forEach(key => {
      cloned[key] = deepClone(obj[key]);
    });
    return cloned;
  }
  return obj;
};

/**
 * Immutable update helper
 * @param {Object} obj - Object to update
 * @param {string} path - Dot-separated path to update
 * @param {*} value - New value
 * @returns {Object} - New object with update applied
 */
const immutableSet = (obj, path, value) => {
  const keys = path.split('.');
  const result = deepClone(obj);
  
  let current = result;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
  return result;
};

/**
 * Maybe monad for handling null/undefined values
 * @param {*} value - Value to wrap
 * @returns {Object} - Maybe object
 */
const Maybe = (value) => ({
  value,
  isNothing: () => value === null || value === undefined,
  map: (fn) => Maybe.isNothing() ? Maybe(null) : Maybe(fn(value)),
  flatMap: (fn) => Maybe.isNothing() ? Maybe(null) : fn(value),
  filter: (predicate) => Maybe.isNothing() || !predicate(value) ? Maybe(null) : Maybe(value),
  getOrElse: (defaultValue) => Maybe.isNothing() ? defaultValue : value,
});

/**
 * Result monad for error handling
 * @param {*} value - Success value
 * @param {*} error - Error value
 * @returns {Object} - Result object
 */
const Result = {
  Ok: (value) => ({
    isOk: () => true,
    isError: () => false,
    map: (fn) => Result.Ok(fn(value)),
    flatMap: (fn) => fn(value),
    mapError: () => Result.Ok(value),
    getOrElse: () => value,
    value,
  }),
  
  Error: (error) => ({
    isOk: () => false,
    isError: () => true,
    map: () => Result.Error(error),
    flatMap: () => Result.Error(error),
    mapError: (fn) => Result.Error(fn(error)),
    getOrElse: (defaultValue) => defaultValue,
    error,
  }),
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} - Promise that resolves with result or rejects after max attempts
 */
const retry = async (fn, maxAttempts = 3, baseDelay = 1000) => {
  let attempt = 1;
  
  while (attempt <= maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
};

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
const debounce = (fn, delay) => {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
};

/**
 * Throttle function calls
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Limit in milliseconds
 * @returns {Function} - Throttled function
 */
const throttle = (fn, limit) => {
  let inThrottle;
  return function throttled(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
};

/**
 * Convert array of objects to a map by key
 * @param {Array} arr - Array to convert
 * @param {string|Function} keySelector - Key selector function or property name
 * @returns {Map} - Map with keys and values
 */
const arrayToMap = (arr, keySelector) => {
  const getKey = typeof keySelector === 'function' 
    ? keySelector 
    : (item) => item[keySelector];
    
  return arr.reduce((map, item) => {
    map.set(getKey(item), item);
    return map;
  }, new Map());
};

/**
 * Group array items by key
 * @param {Array} arr - Array to group
 * @param {string|Function} keySelector - Key selector function or property name
 * @returns {Object} - Grouped object
 */
const groupBy = (arr, keySelector) => {
  const getKey = typeof keySelector === 'function' 
    ? keySelector 
    : (item) => item[keySelector];
    
  return arr.reduce((groups, item) => {
    const key = getKey(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {});
};

module.exports = {
  pipe,
  compose,
  partial,
  curry,
  deepClone,
  immutableSet,
  Maybe,
  Result,
  retry,
  debounce,
  throttle,
  arrayToMap,
  groupBy,
};