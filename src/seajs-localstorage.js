define("seajs-localstorage", function(require) {
  if (!window.localStorage || seajs.data.debug) return

  var data = seajs.data,
    base = seajs.data.base,
    Module = seajs.Module,
    comboSyntax = (data.localstorage && data.localstorage.comboSyntax),
    dependencies = data.localstorage && data.localstorage.dependencies,
    comboMaxLength = (data.localstorage && data.localstorage.comboMaxLength) || 2000,
    tempManifest = (data.localstorage && data.localstorage.manifest) || {},
    remoteManifest = {}

  for (var id in tempManifest) { //将id解析为uri后存入最新的manifest,方便后面比较缓存新鲜度
    tempManifest[id] && (remoteManifest[seajs.resolve(id)] = tempManifest[id])
  }

  var storage = {
    _maxRetry: 1,
    _retry: true,
    get: function(key) {
      var item = localStorage.getItem(key);
      try {
        return JSON.parse(item || 'false');
      } catch (e) {
        return false;
      }
    },
    set: function(key, val, retry) {
      retry = (typeof retry == 'undefined') ? this._retry : retry
      try {
        localStorage.setItem(key, JSON.stringify(val))
        return true
      } catch (e) {
        if (retry) {
          var max = this._maxRetry
          while (max > 0) {
            max--
            this.removeAll()
            return this.set(key, val, false)
          }
        }
      }
    },
    remove: function(key) {
      try {
        localStorage.removeItem(key)
      } catch (e) {}
    },
    removeAll: function() {
      //删除同域下不属于此应用的缓存,一般由于配额超出需要清理
      var prefix = (data.localstorage && data.localstorage.prefix) || /^(?:https?:)?\/\//
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i)
        if (!prefix.test(key)) {
          continue
        }
        if (!remoteManifest[key]) {
          this.remove(key)
        }
      }
    }
  }

  var localManifest = storage.get('manifest', true) || {}

  if (!remoteManifest) {
    return
  }


  //不处理匿名模块,模块的哈希版本发生改变进行缓存的更新
  seajs.on("define", function(data) {
    if (data.uri && remoteManifest[data.uri] && localManifest[data.uri] != remoteManifest[data.uri]) {
      var code = "define('" + data.id + "'," + JSON.stringify(data.deps) + "," + data.factory.toString() + ");"
      if (storage.set(data.uri, code)) {
        localManifest[data.uri] = remoteManifest[data.uri]
        storage.set("manifest", localManifest)
      }
    }

  })

  //发送请求之前构造url
  seajs.on("request", function(data) {
      var combos = [],
        uriSection,
        subDependencies,
        id = data.uri.replace(base, "").replace(/\.js$/, "")

      //处理父模块
      if (localManifest[data.uri] != remoteManifest[data.uri]) {
        uriSection = getUriSection(data.uri)
        combos.push(uriSection.path)
      } else {
        execScript(data.uri, storage.get(data.uri)) && Module.get(data.uri).load()
      }


      //处理子模块依赖
      subDependencies = dependencies[id]
      subDependencies && subDependencies.forEach(function(subMod) {
        var url = seajs.resolve(subMod, data.uri)
        if (remoteManifest[url] && localManifest[url] == remoteManifest[url]) {
          execScript(url, storage.get(url)) && Module.get(url).load()
        }
        if (remoteManifest[url] && localManifest[url] != remoteManifest[url]) {
          combos.push(getUriSection(url).path)
        }
      })

      comboRequest(combos, uriSection, data)

    })
    /**
     * eval字符串代码
     * @param url
     * @param code
     */
  function execScript(url, code) {

    try {
      code += '//@ sourceURL=' + url; //for chrome debug

      (window.execScript || function(data) {
        window['eval'].call(window, data)
      })(code);

    } catch (e) {
      //如果eval代码失败,降级为重新发请求
      seajs.use(url)
    }
    return true
  }

  /**
   * 构造combo的url
   * @param combos 需要combo的数组
   * @param data
   */
  function comboRequest(combos, uriSection, eventData) {
    if (comboSyntax) { //开启combo
      if (combos.length > 1) { //需要combo

        splitCombo(combos, uriSection, eventData)
          //data.requestUri = uriSection.host + comboSyntax[0] + combos.join(comboSyntax[1]) + "?v=" + new Date().getTime()
          //data.requested = true

      } else if (combos.length == 1) { //只有1个js不combo
        eventData.requestUri = uriSection.host + combos[0] + "?v=" + new Date().getTime()
      } else {
        eventData.requested = true //设置此属性可以不发送请求
      }
    }
  }

  /**
   * 获取uri的host和path部分
   * @param uri
   * @returns {{host: (*|string), path: (*|string)}}
   */
  function getUriSection(uri) {
    var regSplit = /(^(?:https?:)?\/\/[^\/]+)([^\?]+)/i;
    var matches = uri.match(regSplit)
    return {
      host: matches[1] || "",
      path: matches[2] || ""
    }
  }

  /**
   * 根据条件考虑url过长的分隔多个请求
   * @param combos
   * @param uriSection
   * @param data
   */
  function splitCombo(combos, uriSection, eventData) {
    var comboBase = uriSection.host + comboSyntax[0],
      comboUrl = comboBase,
      comboSplitParts = []
      //从后往前构造按情况分隔多段的combo数组
    for (var i = combos.length - 1, temp = combos.length; i > -1; i--) {
      comboUrl = comboUrl + combos[i] + (i == 0 ? "" : comboSyntax[1])
      if (comboUrl.length > comboMaxLength) {
        comboSplitParts.push(combos.slice(i, temp))
        comboUrl = comboBase
        temp = i
      }
    }

    eventData.requestUri = comboUrl
    comboSplitParts.forEach(function(part) {
      seajs.request(comboBase + part.join(comboSyntax[1] + "?v=" + new Date().getTime()), function() {
        part.forEach(function(uri) {
          Module.get(uri).load()
        })
      })
    })
  }

})
