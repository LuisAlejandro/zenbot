// Copyright Luis

var z = require('zero-fill')
  , n = require('numbro')
  , ema = require('../../../lib/ema')
  , rsi = require('../../../lib/rsi')
  , stddev = require('../../../lib/stddev')
  , Phenotypes = require('../../../lib/phenotype')

module.exports = {
  name: 'trend_ema_dema',
  description:
    'Buy when (EMA - last(EMA) > 0) and sell when (EMA - last(EMA) < 0), only when short EMA > long EMA.',

  getOptions: function () {
    this.option('period', 'period length, same as --period_length', String, '2m')
    this.option('period_length', 'period length, same as --period', String, '2m')
    this.option('min_periods', 'min. number of history periods', Number, 52)
    this.option('ema_trend_period', 'number of periods for trend EMA', Number, 26)
    this.option('ema_short_period', 'number of periods for the shorter EMA', Number, 10)
    this.option('ema_long_period', 'number of periods for the longer EMA', Number, 21)
    this.option('neutral_rate', 'avoid trades if abs(trend_ema) under this float (0 to disable, "auto" for a variable filter)', Number, 'auto')
    this.option('oversold_rsi', 'buy when RSI reaches this value', Number, 10)
    this.option('overbought_rsi', 'sell when RSI reaches this value', Number, 90)
  },

  calculate: function(s) {
    ema(s, 'ema_trend', s.options.ema_trend_period)
    ema(s, 'ema_short', s.options.ema_short_period)
    ema(s, 'ema_long', s.options.ema_long_period)

    if (s.period.ema_short && s.period.ema_long) {
      s.period.dema_histogram = (s.period.ema_short - s.period.ema_long)
    }
  
    if (s.period.ema_trend && s.lookback[0] && s.lookback[0].ema_trend) {
      s.period.ema_trend_rate = (s.period.ema_trend - s.lookback[0].ema_trend) / s.lookback[0].ema_trend * 100
    }

    if (s.options.neutral_rate === 'auto') {
      stddev(s, 'ema_trend_stddev', Math.floor(s.options.ema_trend_period / 2), 'ema_trend_rate')
    } else {
      s.period.ema_trend_stddev = s.options.neutral_rate
    }

    if (s.options.overbought_rsi) {
      rsi(s, 'overbought_rsi', s.options.rsi_periods)
      if (!s.in_preroll && s.period.overbought_rsi >= s.options.overbought_rsi && !s.overbought && !s.cancel_up) {
        s.overbought = true
        if (!s.options.silent) console.log(('\noverbought at ' + s.period.overbought_rsi + ' RSI, preparing to sell\n').cyan)
      }
    }
    
    if (s.options.oversold_rsi) {
      rsi(s, 'oversold_rsi', s.options.rsi_periods)
      if (!s.in_preroll && s.period.oversold_rsi <= s.options.oversold_rsi && !s.oversold && !s.cancel_down) {
        s.oversold = true
        if (!s.options.silent) console.log(('\noversold at ' + s.period.oversold_rsi + ' RSI, preparing to buy\n').cyan)
      }
    }
  },

  onPeriod: function (s, cb) {
    if (s.in_preroll) return cb()
    
    function pushMessage(title, message) {
      if (s.options.mode === 'live' || s.options.mode === 'paper') {
        s.notifier.pushMessage(title, message)
      }
    }

    if (typeof s.period.overbought_rsi === 'number') {
      if (s.overbought) {
        s.overbought = false
        s.trend = 'overbought'
        s.signal = 'sell'
        s.cancel_up = true
        return cb()
      }
    }

    if (typeof s.period.oversold_rsi === 'number') {
      if (s.oversold) {
        s.oversold = false
        s.trend = 'oversold'
        s.signal = 'buy'
        s.cancel_down = true
        return cb()
      }
    }

    if (typeof s.period.dema_histogram === 'number' && typeof s.lookback[0].dema_histogram === 'number') {

      // bullish market, we buy and enter trend_ema behavior
      if (s.period.dema_histogram > 0) {
        if (s.lookback[0].dema_histogram <= 0) {
          pushMessage(`[${s.exchange.name}.${s.asset}-${s.currency}]`, 'trend_ema_dema intel: 😍 entering bullish market');
          s.signal = 'buy'
          return cb()
        }

        if (typeof s.period.ema_trend_rate === 'number' && typeof s.period.ema_trend_stddev === 'number') {
          if (!s.cancel_up && s.period.ema_trend_rate > s.period.ema_trend_stddev) {
            if (s.trend !== 'up') {
              s.acted_on_trend = false
            }
            s.trend = 'up'
            s.signal = !s.acted_on_trend ? 'buy' : null
            s.cancel_down = false
            return cb()
          } else if (!s.cancel_down && s.period.ema_trend_rate < (s.period.ema_trend_stddev * -1)) {
            if (s.trend !== 'down') {
              s.acted_on_trend = false
            }
            s.trend = 'down'
            s.signal = !s.acted_on_trend ? 'sell' : null
            s.cancel_up = false
            return cb()
          }
        }

      // bearish market, we sell and do nothing, wait for bullish market
      } else if (s.period.dema_histogram < 0) {
        if (s.lookback[0].dema_histogram >= 0) {
          pushMessage(`[${s.exchange.name}.${s.asset}-${s.currency}]`, 'trend_ema_dema intel: 😅 entering bearish market');
          s.signal = 'sell'
          return cb()
        }
      }
    }
    
    s.signal = null
    return cb()
  },

  onReport: function(s) {
    var cols = []
    if (typeof s.period.dema_histogram === 'number') {
      var emacolor = 'grey'
      var demacolor = 'grey'
      if (s.period.dema_histogram > 0) {
        demacolor = 'green'
      } else if (s.period.dema_histogram <= 0) {
        demacolor = 'red'
      }
      if (s.period.ema_trend_rate > s.period.ema_trend_stddev) {
        emacolor = 'green'
      } else if (s.period.ema_trend_rate <= s.period.ema_trend_stddev * -1) {
        emacolor = 'red'
      }
      cols.push(z(10, n(s.period.ema_trend_rate).format('+0.0000'), ' ')[emacolor])
      cols.push(z(10, n(s.period.dema_histogram).format('+0.0000'), ' ')[demacolor])
    }
    else {
      cols.push('         ')
    }
    return cols
  },

  phenotypes: {
    // -- common
    order_type: Phenotypes.ListOption(['maker', 'taker']),
    period_length: Phenotypes.RangePeriod(10, 120, 'm'),
    min_periods: Phenotypes.Range(1, 100),
    markdown_buy_pct: Phenotypes.RangeFloat(-1, 5),
    markup_sell_pct: Phenotypes.RangeFloat(-1, 5),
    profit_stop_enable_pct: Phenotypes.Range0(1, 20),
    profit_stop_pct: Phenotypes.Range(1, 20),
    max_buy_loss_pct: Phenotypes.RangeFloat(0.001, 4),
    max_sell_loss_pct: Phenotypes.RangeFloat(0.001, 4),
    sell_stop_pct: Phenotypes.RangeFloat(1, 4),
    buy_stop_pct: Phenotypes.RangeFloat(1, 4),

    // -- strategy
    ema_short_period: Phenotypes.Range(1, 20),
    ema_long_period: Phenotypes.Range(20, 100),
    ema_trend_period: Phenotypes.Range(1, 40),
    overbought_rsi: Phenotypes.Range(0, 30),
    oversold_rsi: Phenotypes.Range(70, 100),
    rsi_periods: Phenotypes.Range(1, 200)
  },
}

