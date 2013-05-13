// Make sure we have local $ (this is for combined script in a function)
var $ = jQuery;

var Genoverse = Base.extend({

  // Defaults
  urlParamTemplate : 'r=__CHR__:__START__-__END__', // Overwrite this for your URL style
  width            : 1000,
  height           : 200,
  labelWidth       : 90,
  buffer           : 1,
  longestLabel     : 30,
  trackSpacing     : 2,
  defaultLength    : 5000,
  tracks           : [],
  tracksById       : {},
  menus            : [],
  plugins          : [],
  guideLinesByScale: {},
  dragAction       : 'scroll', // options are: scroll, select, off
  wheelAction      : 'off',    // options are: zoom, off
  messages         : {},
  genome           : undefined,
  colors           : {
    background     : '#FFFFFF',
    majorGuideLine : '#CCCCCC',
    minorGuideLine : '#E5E5E5',
    sortHandle     : '#CFD4E7'
  },


  constructor: function (config) {
    if (!this.supported()) {
      this.die('Your browser does not support this functionality');
    }

    // Make sure container is a jquery thingy, jQuery recognises itself automatically
    config.container = $(config.container);

    $.extend(this, config);
    var browser = this;

    $.when(browser.loadGenome(), browser.loadPlugins()).always(function(){
      for (var key in browser) {
        if (typeof browser[key] === 'function' && !key.match(/^(base|extend|constructor|functionWrap|debugWrap)$/)) {
          browser.functionWrap(key);
        }
      }
      browser.init();
    });
  },


  loadGenome: function () {
    if (typeof this.genome == 'string') {
      var genomeName = this.genome;
      return $.ajax({
        url      : this.origin + 'js/genomes/' + genomeName + '.js', 
        dataType : "script",
        context  : this,
        success  : function () {
          try {
            this.genome = eval(genomeName);
          } catch (e) {
            console.log(e);
            this.die('Unable to load genome ' + genomeName);
          }
        }
      });
    }
  },


  loadPlugins: function () {
    var browser = this;
    var loadPluginsTask = $.Deferred();

    // Load plugins css file
    browser.plugins.every(function (plugin, index, array) {
      LazyLoad.css(browser.origin + 'css/' + plugin + '.css');
      return true;
    });

    $.when.apply(
      $, 
      $.map(browser.plugins, function (plugin) {
        return $.ajax({
          url      : browser.origin + 'js/plugins/' + plugin + '.js',
          dataType : "text",
        });
      })
    ).done(function () {
      (function($, scripts){
        // Localize variables
        var $ = $;
        for (var i=0; i<scripts.length; i++) {
          try {
            eval(scripts[i][0]);
          } catch (e) {
            // TODO: add plugin name to this message
            console.log("Error evaluating plugin script: " + e);
            console.log(scripts[i][0]);
          };
        }
      })($, browser.plugins.length == 1 ? [ arguments ] : arguments);
    }).always(function(){
      loadPluginsTask.resolve();
    });

    return loadPluginsTask;
  },


  init: function () {
    var browser = this;    
    var width   = this.width;

    if (!(this.container && this.container.length)) {
      this.die('You must supply a ' + (this.container ? 'valid ' : '') + 'container element');
    }

    this.container.addClass('canvas_container');
   
    this.paramRegex = this.urlParamTemplate ? new RegExp('([?&;])' + this.urlParamTemplate
      .replace(/(\b(\w+=)?__CHR__(.)?)/,   '$2([\\w\\.]+)$3')
      .replace(/(\b(\w+=)?__START__(.)?)/, '$2(\\d+)$3')
      .replace(/(\b(\w+=)?__END__(.)?)/,   '$2(\\d+)$3') + '([;&])'
    ) : '';
    
    this.history          = {};
    this.prev             = {};
    this.backgrounds      = {};
    this.urlParamTemplate = this.urlParamTemplate || '';
    this.useHash          = typeof window.history.pushState !== 'function';
    this.proxy            = $.support.cors ? false : this.proxy;
    this.textWidth        = document.createElement('canvas').getContext('2d').measureText('W').width;
    this.menuContainer    = $('<div class="menu_container">').css({ width: width - 1, left: 1 }).appendTo(this.container);

    this.labelContainer   = $('<ul class="label_container">').appendTo(this.container).sortable({
      items       : 'li:not(.unsortable)',
      handle      : '.handle',
      placeholder : 'label',
      axis        : 'y',
      helper      : 'clone',
      cursor      : 'move',
      start       : function (e, ui) {
        ui.placeholder.css({ height: ui.item.height(), visibility: 'visible', background: browser.colors.sortHandle }).html(ui.item.html());
        ui.helper.hide();
      },
      update      : function (e, ui) {
        ui.item.data('track').container[ui.item[0].previousSibling ? 'insertAfter' : 'insertBefore']($(ui.item[0].previousSibling || ui.item[0].nextSibling).data('track').container);
        // Correct the order
        var newOrderTracks = [];
        // Well, this is dodgy, but hopefully .children will always give us LIs in order of appearence
        browser.labelContainer.children('li').each(function (i) {
          if ($(this).data('track')) {
            newOrderTracks.push($(this).data('track'));
          }
        });
        browser.tracks = newOrderTracks;
      }
    });

    this.labelWidth       = this.labelContainer.outerWidth(true);
    this.wrapperLeft      = this.labelWidth - width;
    this.width           -= this.labelWidth;

    this.wrapper  = $('<div class="gv_wrapper">').appendTo(this.container);
    this.selector = $('<div class="selector crosshair"></div>').appendTo(this.wrapper);

    this.container.width(width);
    
    this.selectorControls = $('                      \
      <div class="selector_controls">                \
        <button class="zoomHere">Zoom here</button>  \
        <button class="center">Center</button>       \
        <button class="cancel">Cancel</button>       \
      </div>                                         \
    ').appendTo(this.selector);
    
    this.zoomInHighlight = $('     \
      <div class="canvas_zoom i">  \
        <div class="t l h"></div>  \
        <div class="t r h"></div>  \
        <div class="t l v"></div>  \
        <div class="t r v"></div>  \
        <div class="b l h"></div>  \
        <div class="b r h"></div>  \
        <div class="b l v"></div>  \
        <div class="b r v"></div>  \
      </div>                       \
    ').appendTo('body');
    
    this.zoomOutHighlight = this.zoomInHighlight.clone().toggleClass('i o').appendTo('body');

    var urlCoords = this.getURLCoords();
    var coords    = urlCoords.chr && urlCoords.start && urlCoords.end 
                     ? urlCoords 
                     : { chr: this.chr, start: this.start, end: this.end };

    this.chr = coords.chr;
    if (!this.chromosomeSize && this.genome) {
      this.chromosomeSize = this.genome[this.chr].size;
    }    

    this.setRange(coords.start, coords.end);
    this.setHistory();
    this.setTracks();
    //this.makeImage();
    this.addUserEventHandlers();
  },


  addUserEventHandlers: function () {
    var browser = this;
    
    this.container.on({
      mousedown: function (e) {
        // Only scroll on left click, and do nothing if clicking on a button in selectorControls
        if ((!e.which || e.which === 1) && !(this === browser.selector[0] && e.target !== this)) {
          browser.mousedown(e);
        }
        
        return false;
      },

      mousewheel: function (e, delta, deltaX, deltaY) {
        if(deltaY === 0 && deltaX !== 0) {
          browser.move(null, -deltaX * 10);
        } else if (browser.wheelAction === 'zoom') {
          return browser.mousewheelZoom(e, delta);
        }
      },

      dblclick: function (e) {
        browser.mousewheelZoom(e, +1);
      }
    }, '.image_container, .overlay, .selector, .message_container');

    $(document).on({
      mouseup   : $.proxy(this.mouseup,   this),
      mousemove : $.proxy(this.mousemove, this),
      keydown   : $.proxy(this.keydown,   this),
      keyup     : $.proxy(this.keyup,     this)
    });
    
    this.selectorControls.on('click', function (e) {
      var left  = browser.selector.position().left;
      var width = browser.selector.outerWidth(true);
      var start = Math.round(left / browser.scale) + browser.start;
      var end   = Math.round((left + width) / browser.scale) + browser.start - 1;
          end   = end <= start ? start : end;
      
      switch (e.target.className) {
        case 'zoomHere' : browser.setRange(start, end, true); break;
        case 'center'   : var delta = browser.width / 2 - (left + width / 2); browser.move(delta); browser.selector.css({ left: left+delta }); break;
        case 'summary'  : browser.summary(start, end); break;
        case 'cancel'   : browser.cancelSelect(); break;
        default         : break;
      }
    });
    
    if (this.useHash) {
      $(window).on('hashchange', function () {  
        browser.popState();
      });
    } else {
      window.onpopstate = function () {
        browser.popState();
      };
    }
  },


  reset: function () {
    var i = this.tracks.length;
    
    while (i--) {
      this.tracks[i].reset(false);
    }
    
    this.scale   = 9e99; // arbitrary value so that setScale resets track scales as well
    this.history = {};
    
    this.setRange(this.start, this.end);
  },

  
  mousewheelZoom: function (e, delta) {
    var browser = this;
    
    clearTimeout(this.zoomDeltaTimeout);
    clearTimeout(this.zoomTimeout);
    
    this.zoomDeltaTimeout = setTimeout(function () {
      if (delta > 0) {
        browser.zoomInHighlight.css({ left: e.pageX - 20, top: e.pageY - 20, display: 'block' }).animate({
          width: 80, height: 80, top: '-=20', left: '-=20'
        }, {
          complete: function () { $(this).css({ width: 40, height: 40, display: 'none' }); }
        });
      } else {
        browser.zoomOutHighlight.css({ left: e.pageX - 40, top: e.pageY - 40, display: 'block' }).animate({
          width: 40, height: 40, top: '+=20', left: '+=20'
        }, {
          complete: function () { $(this).css({ width: 80, height: 80, display: 'none' }); }
        });
      }
    }, 100);
    
    this.zoomTimeout = setTimeout(function () {
      browser[delta > 0 ? 'zoomIn' : 'zoomOut'](e.pageX - browser.container.offset().left - browser.labelWidth);
      
      if (browser.dragAction === 'select') {
        browser.moveSelector(e);
      }
    }, 300);
    
    return false;
  },

  
  startDragScroll: function (e) {
    this.dragging   = true;
    this.scrolling  = !e;
    this.prev.left  = this.left;
    this.dragOffset = e ? e.pageX - this.left : 0;
    this.dragStart  = this.start;
  },

  
  stopDragScroll: function (e, update) {
    this.dragging  = false;
    this.scrolling = false;
    
    $('.overlay', this.wrapper).add('.gv-menu', this.menuContainer).add(this.selector).css({
      left       : function (i, left) { return (this.className.indexOf('selector') === -1 ? 0 : 1) + parseFloat(left, 10) + parseFloat($(this).css('marginLeft'), 10); },
      marginLeft : function ()        { return  this.className.indexOf('selector') === -1 ? 0 : -1 }
    });
    
    if (update !== false) {
      if (this.start !== this.dragStart) {
        this.updateURL();
        this.setHistory();
        this.redraw();
      }
    }
  },

  
  startDragSelect: function (e) {
    if (!e) {
      return false;
    }
    
    var x = Math.max(0, e.pageX - this.wrapper.offset().left - 2);
    
    this.dragging        = true;
    this.selectorStalled = false;
    this.selectorStart   = x;
    
    this.selector.css({ left: x, width: 0 }).removeClass('crosshair');
    this.selectorControls.hide();
  },

  
  stopDragSelect: function (e) {
    if (!e) {
      return false;
    }

    this.dragging        = false;
    this.selectorStalled = true;
    
    if (this.selector.outerWidth(true) < 2) { 
      return this.cancelSelect();
    }
    
    var top = Math.min(e.pageY - this.wrapper.offset().top, this.wrapper.outerHeight(true) - 1.2*this.selectorControls.outerHeight(true));

    this.selectorControls.css({
      top  : top,
      left : this.selector.outerWidth(true) / 2 - this.selectorControls.outerWidth(true) / 2
    }).show();
  },

  
  cancelSelect: function () {
    this.dragging        = false;
    this.selectorStalled = false;
    
    this.selector.addClass('crosshair').width(0);
    this.selectorControls.hide();
    
    if (this.dragAction === 'scroll') {
      this.selector.hide();
    }
  },

  
  dragSelect: function (e) {
    var x = e.pageX - this.wrapper.offset().left;

    if (x > this.selectorStart) {
      this.selector.css({ 
        left  : this.selectorStart, 
        width : Math.min(x - this.selectorStart, this.width - this.selectorStart - 1)
      });
    } else {
      this.selector.css({ 
        left  : Math.max(x, 1), 
        width : Math.min(this.selectorStart - x, this.selectorStart - 1)
      });
    }    
  },

  
  setDragAction: function (action, keepSelect) {
    this.dragAction = action;
    
    if (this.dragAction === 'select') {
      this.selector.addClass('crosshair').width(0).show();
    } else if (keepSelect && !this.selector.hasClass('crosshair')) {
      this.selectorStalled = false;
    } else {
      this.cancelSelect();
      this.selector.hide();
    }
  },
  
  
  toggleSelect: function (on) {
    if (on) {
      this.prev.dragAction = 'scroll';
      this.setDragAction('select');
    } else {
      this.setDragAction(this.prev.dragAction, true);
      delete this.prev.dragAction;
    }
  },
  
  
  setWheelAction: function (action) {
    this.wheelAction = action;
  },
  
  
  keydown: function (e) {
    if (e.which === 16 && !this.prev.dragAction && this.dragAction === 'scroll') { // shift key
      this.toggleSelect(true);
    }

    if (e.which === 27) {
      this.cancelSelect();
      this.closeMenus();
    }
  },
  
  
  keyup: function (e) {
    if (e.which === 16 && this.prev.dragAction) { // shift key
      this.toggleSelect();
    }
  },
  
  
  mousedown: function (e) {
    if (e.shiftKey) {
      if (this.dragAction === 'scroll') {
        this.toggleSelect(true);
      }
    } else if (this.prev.dragAction) {
      this.toggleSelect();
    }
    
    switch (this.dragAction) {
      case 'select' : this.startDragSelect(e); break;
      case 'scroll' : this.startDragScroll(e); break;
      default       : break;
    }
  },
  
 
  mouseup: function (e, update) {
    if (!this.dragging) {
      return false;
    }
    
    switch (this.dragAction) {
      case 'select' : this.stopDragSelect(e);         break;
      case 'scroll' : this.stopDragScroll(e, update); break;
      default       : break;
    }
  },
  
  
  mousemove: function (e) {
    if (this.dragging && !this.scrolling) {
      switch (this.dragAction) {
        case 'scroll' : this.move(e.pageX - this.dragOffset - this.left); break;
        case 'select' : this.dragSelect(e); break;
        default       : break;
      }
    } else if (this.dragAction === 'select') {
      this.moveSelector(e);
    }
  },

  
  moveSelector: function (e) {
    if (!this.selectorStalled) {
      this.selector.css('left', e.pageX - this.wrapper.offset().left - 2);
    }
  },

  
  move: function (delta, callback) {
    var wrapperOffset = this.wrapper.offset().left;
    var start, end, step;
    var scale = this.scale;

    if (this.menus.length) this.closeMenus();

    // Force stepping by base pair when in small regions
    if (scale > 1) {
      this.left = Math.round(this.left / scale) * scale; 
      if (delta) {
        delta = Math.round(delta / scale) * scale;
      }
    }
    
    if (this.left + delta < this.minLeft) {
      delta = this.minLeft - this.left;
    } else if (this.left + delta > this.maxLeft) {
      delta = this.maxLeft - this.left;
    }

    this.left += delta;
    start = this.start - delta / scale;
    if (start < 1) start = 1;
    end   = start + this.length - 1;
    
    for (var i=0; i < this.tracks.length; i++) {
      this.tracks[i].move(delta, scale)
    }

    this.setRange(start, end);
  },
  

  setRange: function (start, end, update, force) {
    this.prev.start = this.start;
    this.prev.end   = this.end;
    this.start      = typeof start === 'number' ? Math.floor(start) : parseInt(start, 10);
    this.end        = typeof end   === 'number' ? Math.floor(end)   : parseInt(end,   10);
    
    if (this.start < 1) {
      this.start = 1;
    }
    
    if (this.end > this.chromosomeSize) {
      this.end = this.chromosomeSize;
    }

    if (!this.end || !(this.end > this.start)) {
      this.end = this.start + this.defaultLength;
    }
    
    this.length = this.end - this.start + 1;
    
    this.setScale(force);

    if (update === true && (this.prev.start !== this.start || this.prev.end !== this.end)) {
      this.updateURL();
      this.setHistory();
      this.makeImage();
    }
  },


  setScale: function (force) {
    this.prev.scale  = this.scale;
    this.scale       = this.width / this.length;
    this.scaledStart = this.start * this.scale;
    
    if (force || this.prev.scale !== this.scale) {
      this.dataRegion  = { start: 9e99, end: -9e99 };
      this.offsets     = { right: this.width, left: -this.width };
      this.left        = 0;
      this.prev.left   = 0;
      this.minLeft     = Math.round((this.end   - this.chromosomeSize) * this.scale);
      this.maxLeft     = Math.round((this.start - 1) * this.scale);
      this.scrollStart = 'ss_' + this.start + '_' + this.end;
      this.labelBuffer = Math.ceil(this.textWidth / this.scale) * this.longestLabel;

      if (this.prev.scale) {
        var i = this.tracks.length;
        
        this.cancelSelect();
        this.menuContainer.children().hide();
        
        while (i--) {
          this.tracks[i].setScale(this.scale);
        }
        
        if (this.backgrounds) {
          for (var c in this.backgrounds) {
            i = this.backgrounds[c].length;
            
            while (i--) {
              this.backgrounds[c][i].scaledStart = this.backgrounds[c][i].start * this.scale;
              this.backgrounds[c][i].scaledEnd   = this.backgrounds[c][i].end   * this.scale;
            }
          }
        }
      }
    }
  },

  
  checkHeights: function () {
    if (this.dragging) {
      return;
    }
    
    for (var i = 0; i < this.tracks.length; i++) {
      if (!this.tracks[i].fixedHeight) {
        this.tracks[i].checkHeight();
        
        // This should be in track!
        // if (this.tracks[i].autoHeight || this.tracks[i].separateLabels) {
        //   this.tracks[i].resize(this.tracks[i][this.tracks[i].autoHeight ? 'fullVisibleHeight' : 'height'], this.tracks[i].labelTop);
        // } else {
        //   this.tracks[i].toggleExpander();
        // }

      }
    }
  },

  
  resetTrackHeights: function () {
    var track;
    
    for (var i = 0; i < this.tracks.length; i++) {
      track = this.tracks[i];
      
      if (track.resizable) {
        // track.autoHeight = !!([ (track.config || {}).autoHeight, track.defaults.autoHeight, this.autoHeight ].sort(function (a, b) {
        //   return (typeof a !== 'undefined' && a !== null ? 0 : 1) - (typeof b !== 'undefined' && b !== null ?  0 : 1);
        // })[0]);
        
        track.heightToggler[track.autoHeight ? 'addClass' : 'removeClass']('auto_height');
        track.resize(track.height + track.spacing);
      }
    }
  },
  
  
  zoomIn: function (x) {
    if (!x) {
      x = this.width / 2;
    }
    
    var start = Math.round(this.start + x / (2 * this.scale));
    var end   = this.length === 2 ? start : Math.round(start + (this.length - 1) / 2);
    
    this.setRange(start, end, true);
  },

  
  zoomOut: function (x) {
    if (!x) {
      x = this.width / 2;
    }
    
    var start = Math.round(this.start - x / this.scale);
    var end   = this.length === 1 ? start + 1 : Math.round(start + 2 * (this.length - 1));
    
    if (start < 1) {
      start = 1;
    }
    
    if (end > this.chromosomeSize) {
      end = this.chromosomeSize;
    }
    
    this.setRange(start, end, true);
  },
  
  
  redraw: function () {
    if (this.left === 0 || (this.left > 0 && this.left < this.offsets.right) || (this.left < 0 && Math.abs(this.left) < Math.abs(this.offsets.left + this.wrapperLeft))) {
      return false;
    }
    
    //this.makeImage();
    
    return true;
  },


  setTracks: function (tracks, index) {
    var defaults = {
      browser         : this,
      width           : this.width
    };
    
    var push = !!tracks;
    var hierarchy, Class, subClass;
    
    tracks = tracks || this.tracks;
    index  = index  || 0;
    
    for (var i = 0; i < tracks.length; i++) {
      if (typeof tracks[i].extend === 'function') {
        continue;
      }
      
      // Well, this is probably ugly, there could be a nicer way of doing it.
      hierarchy = (tracks[i].type || '').split('.');
      Class     = Genoverse.Track;

      while (subClass = hierarchy.shift()) {
        Class = Class[subClass];
      }

      tracks[i] = new Class($.extend(true, {}, tracks[i], defaults));

      // set the reference to the browser
      //
      // andrewtikhonov:
      // tracks might accidentally create
      // their own 'browser' variable, which
      // will be silently overridden, which
      // is obviously not perfect
      //
      // EugeneBragin:
      // Hmm, not sure about this one, 
      // could you give one example?
      tracks[i].browser = this;

      if (push) {
        this.tracks.push(tracks[i]);
      }
      
      if (tracks[i].strand === -1 && tracks[i].orderReverse) {
        tracks[i].order = tracks[i].orderReverse;
      }

      if (tracks[i].id) {
        this.tracksById[tracks[i].id] = tracks[i];
      }
    }
    
    // if (!push) {
    //   this.sortTracks(); // initial sort
    // }
    
    return tracks;
  },
  
  
  addTrack: function (track) {
    this.addTracks([ track ]);
  },
  
  
  addTracks: function (tracks) {
    this.setTracks(tracks, this.tracks.length);
    //this.sortTracks();
  },
  
  
  removeTrack: function (track) {
    // splice tracks array
    for (var i=0; i<this.tracks.length; i++) {
      if (track == this.tracks[i]) {
        this.tracks.splice(i, 1);
        break;
      }
    }

    // Destroy DOM elements and track itself
    track.destroy();
  },
  
  
  updateTracks: function (redrawBackground) {
    var i = this.tracks.length;
    
    while (i--) {
      // redraw all backgrounds if a track which contributed to this.backgrounds has been added removed
      if (redrawBackground) {
        $(this.tracks[i].imgContainers).each(function () {
          $(this).children('.bg').remove().end().data('img').drawBackground();
        });
      }

    }
  },
  
  
  sortTracks: function () {
    var sorted     = $.extend([], this.tracks).sort(function (a, b) { return a.order - b.order; });
    var labels     = $();
    var containers = $();
    
    for (var i = 0; i < sorted.length; i++) {
      labels.push(sorted[i].label[0]);
      containers.push(sorted[i].container.detach()[0]);
    }
    
    this.labelContainer.append(labels);
    this.wrapper.append(containers);
    
    sorted = labels = containers = null;
  },
  
  
  makeImage: function () {
  },


  // makeImage: function () {
  //   //debugger;
  //   var left = -this.left;
  //   var dir  = left < 0 ? 'right' : 'left';
  //   var start, end;
    
  //   if (left) {
  //     start = left > 0 ? this.dataRegion.end   : this.dataRegion.start - (this.buffer * this.length);
  //     end   = left < 0 ? this.dataRegion.start : this.dataRegion.end   + (this.buffer * this.length);
  //   } else {
  //     start = Math.max(this.start, 1);
  //     end   = Math.min(this.end + 1, this.chromosomeSize);
  //   }
    
  //   var width = Math.round((end - start) * this.scale);
    
  //   this.dataRegion.start = Math.min(start, this.dataRegion.start);
  //   this.dataRegion.end   = Math.max(end,   this.dataRegion.end);
  //   this.offsets[dir]    += width;
    
  //   if (this.updateFromHistory()) {
  //     return;
  //   }
    
  //   this.makeTrackImages(this.tracks, start, end, width);
  // },
  
  
  // makeTrackImages: function (tracks, start, end, width) {
  //   start = start || this.dataRegion.start;
  //   end   = end   || this.dataRegion.end;
  //   width = width || Math.round((end - start + 1) * this.scale);
    
  //   // Maximum texture width is 32Kb. Above this, images will fail to load.
  //   // FIXME: rewrite so that addTrack/setRenderer cannot create an image that is this wide
  //   if (width > 32 * 1024) {
  //     return this.reset();
  //   }
    
  //   var left       = -this.left;
  //   var dataRegion = $.extend({}, this.dataRegion);
  //   var offsets    = $.extend({}, this.offsets);
  //   var allTracks  = tracks.length === this.tracks.length;


  //   // var overlay    = this.makeOverlays(width, allTracks ? false : tracks);
  //   // function removeOverlay() {
  //   //   if (overlay) {
  //   //     overlay.remove();
  //   //     overlay = null;
  //   //   }
  //   // }
    
  //   for (var i=0; i<tracks.length; i++) {
  //     tracks[i].makeImage(start, end, width, left, this.scale);
  //   }

  //   // $.when.apply($, $.map(tracks, function (track) { return track.makeImage(start, end, width, left, browser.scrollStart); })).done(function () {
  //   //   var redraw = false;
      
  //   //   $.when.apply($, $.map($.map(arguments, function (a) {
  //   //     $(a.target).show();
  //   //     return a.img;
  //   //   }), function (i) {
  //   //     if (i.track.backgrounds && !allTracks) {
  //   //       i.track.scaleFeatures(i.track.backgrounds);
  //   //       redraw = true;
  //   //     }
        
  //   //     return i.drawBackground();
  //   //   })).done(removeOverlay);
      
  //   //   if (allTracks) {
  //   //     browser.prev.history = browser.start + '-' + browser.end;
  //   //     browser.setHistory(dataRegion, offsets);
  //   //   } else {
  //   //     browser.updateTracks(redraw);
  //   //   }
      
  //   //   browser.checkTrackSize();
  //   // }).fail(removeOverlay);
  // },
  
  
  makeOverlays: function (width, tracks) {
    var overlay = $('<div class="overlay">').css({ left: this.left && !tracks ? (width - (Math.abs(this.left) % width)) * (width > Math.abs(this.left) || this.left > 0 ? -1 : 1) : -this.offsets.right, width: width });
    
    if (tracks) {
      overlay = $($.map(
        $.map(tracks, function (t) { return [ t, t.forwardTrack || t.reverseTrack ]; }),
        function (track) { return track ? overlay.clone().addClass('track').css({ top: track.container.position().top, height: track.height })[0] : false; }
      ));
    }
    
    return overlay.prependTo(this.wrapper);
  },
  
  
  updateURL: function () {
    if (!this.urlParamTemplate) {
      return;
    }
    
    if (this.useHash) {
      window.location.hash = this.getQueryString();
    } else {
      window.history.pushState({}, '', this.getQueryString());
    }
  },
  
  
  setHistory: function (dataRegion, offsets) {
    if (this.prev.history) {
      var history = {
        dataRegion : dataRegion || this.history[this.prev.history].dataRegion,
        offsets    : offsets    || this.history[this.prev.history].offsets
      };
      
      if (!this.history[this.start + '-' + this.end] || (dataRegion && offsets)) {
        this.history[this.start + '-' + this.end] = $.extend({
          left        : this.left,
          scrollStart : this.scrollStart
        }, history);
      }
      
      if (dataRegion && offsets) {
        for (var i in this.history) {
          if (this.history[i].scrollStart === this.scrollStart) {
            $.extend(this.history[i], history);
          }
        }
      }
    }
  },
  
  
  popState: function () {
    var coords = this.getURLCoords();
    
    if (coords.start && !(parseInt(coords.start, 10) === this.start && parseInt(coords.end, 10) === this.end)) {
      this.setRange(coords.start, coords.end);
      
      if (!this.updateFromHistory()) {
        this.reset();
      }
    }
    
    var delta = Math.round((this.start - this.prev.start) * this.scale);
    
    $('.gv-menu', this.menuContainer).css('left', function (i, left) { return parseFloat(left, 10) - delta; });
  },
  
  
  updateFromHistory: function () {
    var history = this.history[this.start + '-' + this.end];
    
    if (history && (this.prev.start !== this.start || this.prev.end !== this.end)) {
      var images = $('.track_container .' + history.scrollStart, this.container);
      
      if (images.length) {
        var newTracks = $.grep(this.tracks, function (track) { return !$(track.imgContainers).filter('.' + history.scrollStart).length; });
        
        $('.track_container', this.container).css('left', history.left).children('.image_container').hide();
        
        $.extend(this, history);
        
        if (newTracks.length) {
          this.makeTrackImages(newTracks);
        }
        
        this.checkHeights();
        
        images.show();
        images = null;
        
        return true;
      }
    }
    
    return false;
  },
  
  
  getURLCoords: function () {
    var coords = { chr: null, start:null, end:null };

    // check url parameters are not empty
    if (window.location.hash == "" && window.location.search == "") {
        return coords;
    }

    try {
      var match  = ((this.useHash ? window.location.hash.replace(/^#/, '?') ||
          window.location.search : window.location.search) + '&').match(this.paramRegex).slice(2, -1);

      var i = 0;
      
      $.each(this.urlParamTemplate.split('__'), function () {
        var tmp = this.match(/^(CHR|START|END)$/);
        
        if (tmp) {
          coords[tmp[1].toLowerCase()] = match[i++];
        }
      });
    } catch(e) {

    }

    return coords;
  },
  

  getQueryString: function () {
    var location = this.urlParamTemplate
      .replace('__CHR__',   this.chr)
      .replace('__START__', this.start)
      .replace('__END__',   this.end);

    if (this.useHash) {
        return location;
    }

    // no parameters
    if (window.location.search == "") {
        return "?" + location;
    }

    // otherwise
    return (window.location.search + '&').
        replace(this.paramRegex, '$1' + location + '$5').slice(0, -1);
  },
    

  supported: function () {
    var elem = document.createElement('canvas');
    return !!(elem.getContext && elem.getContext('2d'));
  },
  

  die: function (error) {
    alert(error);
    throw(error);
  },


  menuTemplate: $('<div class="gv_menu"> <div class="close">x</div> <table></table> </div>').on('click', function (e) {
    if ($(e.target).hasClass('close')) {
      $(this).fadeOut('fast', function () {
        var feature = $(this).data('feature');
        if (feature && feature['_menu']) delete feature['_menu'];
        $(this).remove();
      });
    }
  }),  


  makeMenu: function (feature, position, track) {
    if (feature._menu) return feature._menu;

    var wrapper = this.wrapper;
    var offset  = wrapper.offset();
    var menu    = this.menuTemplate.clone(true).data({ feature: feature }).appendTo($('body'));

    this.menus.push(menu);
    
    if (track) {
      track.menus.push(menu[0]);
    }
    
    $.when(track ? track.populateMenu(feature) : feature).done(function (feature) {
      if (Object.prototype.toString.call(feature) !== "[object Array]") feature = [ feature ];

      feature.every(function(feature) {
        $('table', menu).append(
          (feature.title ? '<tr class="header"><th colspan="2" class="title">' + feature.title + '</th></tr>' : '') +
          $.map(feature, function (value, key) {
            if (key !== 'title') {
              return '<tr><td>'+ key +'</td><td>'+ value +'</td></tr>';
            }
          }).join()
        );
        return true;
      });
      
      menu.show().css(
        position || 
        { 
          top  : Math.max(offset.top, $(document).scrollTop()) + menu.outerHeight(true)/10,
          left : offset.left + (wrapper.outerWidth(true) - menu.outerWidth(true))/2
        }
      );

      if (track && track.id) {
        menu.addClass(track.id);
      }
    });
    
    feature._menu = menu;
    return menu;
  },


  closeMenus: function () {
    var i = this.menus.length;
    while (i--) {
      $('.close', this.menus[i]).click();
    }
    this.menus = [];
  },


  // Provide summary of a region (as a popup menu)
  summary: function (start, end) {
    alert(
      'Not implemented' + "\n" +
      'Start: ' + start + "\n" +
      'End: '   + end   + "\n"
    );
  },


  /**
   * functionWrap - wraps event handlers and adds debugging functionality
   **/
  functionWrap: function (key, obj) {
    var name = (obj ? (obj.name || 'Track' + obj.type) : 'Genoverse') + '.' + key;
    obj = obj || this;

    if ((key.indexOf('after') === 0) || (key.indexOf('before') === 0)) {
      if (!obj.systemEventHandlers[key]) obj.systemEventHandlers[key] = [];
      obj.systemEventHandlers[key].push(obj[key]);
      return;
    }

    var func = key.substring(0, 1).toUpperCase() + key.substring(1);
    
    if (obj.debug) {
      this.debugWrap(obj, key, name, func);
    }

    // turn function into system event, enabling eventHandlers for before/after the event
    if (obj.systemEventHandlers['before' + func] || obj.systemEventHandlers['after' + func]) {
      obj['__original' + func] = obj[key];

      obj[key] = function () {
        var i, rtn;
        
        if (this.systemEventHandlers['before' + func]) {
          for (i = 0; i < this.systemEventHandlers['before' + func].length; i++) {
            // TODO: Should it end when beforeFunc returned false??
            this.systemEventHandlers['before' + func][i].apply(this, arguments);
          }
        }
        
        rtn = this['__original' + func].apply(this, arguments);
        
        if (this.systemEventHandlers['after' + func]) {
          for (i = 0; i < this.systemEventHandlers['after' + func].length; i++) {
            // TODO: Should it end when afterFunc returned false??
            this.systemEventHandlers['after' + func][i].apply(this, arguments);
          }
        }
        
        return rtn;
      };
    }
  },
  

  debugWrap: function (obj, key, name, func) {
    // Debugging functionality
    // Enabled by "debug": true || { functionName: true, ...} option
    // if "debug": true, simply log function call
    if (obj.debug === true) {
      if (!obj.systemEventHandlers['before' + func]) {
        obj.systemEventHandlers['before' + func] = [];
      }
      
      obj.systemEventHandlers['before' + func].unshift(function () {
        console.log(name);
      });
    }
    
    // if debug: { functionName: true, ...}, log function time
    if (typeof obj.debug === 'object' && obj.debug[key]) {
      if (!obj.systemEventHandlers['before' + func]) {
        obj.systemEventHandlers['before' + func] = [];
      }
      
      if (!obj.systemEventHandlers['after' + func]) {
        obj.systemEventHandlers['after' + func] = [];
      }
      
      obj.systemEventHandlers['before' + func].unshift(function () {
        //console.log(name, arguments);        
        console.time('time: ' + name);
      });
      
      obj.systemEventHandlers['after' + func].push(function () {
        console.timeEnd('time: ' + name);
      });
    }
  },
  
  systemEventHandlers: {}
}, {
  on: function (events, handler) {
    $.each(events.split(' '), function () {
      if (typeof Genoverse.prototype.systemEventHandlers[this] === 'undefined') {
        Genoverse.prototype.systemEventHandlers[this] = [];
      }
      
      Genoverse.prototype.systemEventHandlers[this].push(handler);
    });
  }
});


Genoverse.on('afterMove afterZoomIn afterZoomOut', function () {
  // $('.static', this.wrapper).css('left', -this.left);
  this.checkHeights();
});

window.Genoverse = Genoverse;

Genoverse.prototype.origin = ($('script:last').attr('src').match(/(.*)js\/\w+\.js/))[1];
LazyLoad.css(Genoverse.prototype.origin + 'css/genoverse.css');
