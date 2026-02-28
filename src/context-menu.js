class ContextMenu {
    constructor() {
        this.overlay = null;
        this.menu = null;
        this.items = [];
        this.currentIndex = 0;
        this.onSelectCallback = null;
        this.createOverlay();
    }

    createOverlay() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'context-menu-overlay';
        
        // Create menu container
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu';
        
        this.overlay.appendChild(this.menu);
        document.body.appendChild(this.overlay);
    }

    show(options, onSelect) {
        this.onSelectCallback = onSelect;
        this.currentIndex = 0;
        
        // Clear existing items
        this.menu.innerHTML = '';
        this.items = [];
        
        // Create menu items
        options.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.dataset.action = option.action;
            
            // Icon
            const icon = document.createElement('img');
            icon.src = option.icon;
            icon.className = 'context-menu-icon';
            icon.alt = '';
            
            // Text
            const text = document.createElement('span');
            text.className = 'context-menu-text';
            text.textContent = option.label;
            
            item.appendChild(icon);
            item.appendChild(text);
            this.menu.appendChild(item);
            this.items.push(item);
            
            // Click handler
            item.onclick = () => this.selectItem(index);
        });
        
        // Show overlay
        this.overlay.classList.add('active');
        
        // Focus first item
        this.focusItem();
    }

    hide() {
        this.overlay.classList.remove('active');
        this.onSelectCallback = null;
    }

    focusItem() {
        // Remove focus from all items
        this.items.forEach(item => item.classList.remove('focused'));
        
        // Focus current item
        if (this.items[this.currentIndex]) {
            this.items[this.currentIndex].classList.add('focused');
        }
    }

    selectItem(index = this.currentIndex) {
        const item = this.items[index];
        if (item && this.onSelectCallback) {
            const action = item.dataset.action;
            this.onSelectCallback(action);
        }
        this.hide();
    }

    handleArrowUp() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.focusItem();
        }
    }

    handleArrowDown() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.focusItem();
        }
    }

    handleEnter() {
        this.selectItem();
    }

    handleBack() {
        this.hide();
    }

    isActive() {
        return this.overlay.classList.contains('active');
    }
}

module.exports = ContextMenu;
